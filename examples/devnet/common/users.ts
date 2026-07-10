import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Account,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token"
import * as config from './config';
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import axios from "axios";
import { Txoracle } from "../types/txoracle";
import nacl from "tweetnacl";
import bs58 from "bs58";

export type User = {
  user: anchor.web3.Keypair;
  userTokenAccount: Account | undefined;
  /** Public signature of the confirmed subscription transaction, when applicable. */
  txSig?: string;
  activationStatus: "activated" | "api-token-bypass";
};

export type UserAuthState = {
  apiToken: string;
  jwt: string;
  refreshPromise: Promise<string> | null;
  authGeneration: number;
  /** Last confirmed subscription, retained until activation succeeds or the state is cleared. */
  confirmedTxSig?: string;
  /** Locally signed transaction whose RPC submission/confirmation outcome was ambiguous. */
  submittedTxSig?: string;
};

export type SubscriptionConfirmation = {
  txSig: string;
  userTokenAccount: Account;
};

export type ActivationOptions = {
  name: string;
  user: anchor.web3.Keypair;
  txSig: string;
  selectedLeagues: number[];
  /** Number of retries after the first request for transient network/5xx failures. */
  maxTransientRetries?: number;
  retryBaseDelayMs?: number;
};

const SUBSCRIPTION_RECOVERY_SCHEMA = "txline-subscription-recovery/v1" as const;

type SubscriptionRecoveryContext = {
  wallet: string;
  genesisHash: string;
  programId: string;
  tokenMint: string;
  apiBaseUrl: string;
  serviceLevelId: number;
  weeks: number;
  selectedLeagues: number[];
};

type SubscriptionRecoveryRecord = SubscriptionRecoveryContext & {
  schema: typeof SUBSCRIPTION_RECOVERY_SCHEMA;
  source: "locally-signed" | "provided";
  txSig: string;
  createdAt: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

type BeforeSubscriptionBroadcast = (
  txSig: string,
  latestBlockhash: Readonly<{ blockhash: string; lastValidBlockHeight: number }>,
) => Promise<void>;

/**
 * Redacted HTTP error safe to print. It deliberately omits request config,
 * headers, response bodies, JWTs, wallet signatures, and API tokens.
 */
export class SafeHttpError extends Error {
  readonly isAxiosError = true;
  readonly status?: number;
  readonly code?: string;
  readonly response?: { readonly status: number };

  constructor(operation: string, status?: number, code?: string) {
    const message = status === 401
      ? `${operation} failed with HTTP 401 (guest JWT invalid or expired)`
      : status === 403
        ? `${operation} failed with HTTP 403 (API token, subscription, or bundle permission denied; JWT was not renewed)`
        : status !== undefined
          ? `${operation} failed with HTTP ${status}`
          : code
            ? `${operation} failed (${code})`
            : `${operation} failed`;

    super(message);
    this.name = "SafeHttpError";
    this.status = status;
    this.code = code;
    this.response = status === undefined ? undefined : { status };
  }
}

/** Activation failed after an on-chain transaction was already confirmed. */
export class SubscriptionActivationError extends Error {
  readonly txSig: string;
  readonly status?: number;

  constructor(txSig: string, error: SafeHttpError) {
    super(
      `Subscription transaction ${txSig} is confirmed, but activation failed. `
      + `Retry activation with this txSig; do not submit another subscription. ${error.message}`
    );
    this.name = "SubscriptionActivationError";
    this.txSig = txSig;
    this.status = error.status;
  }
}

/** A signed transaction may have reached the cluster, but its outcome is unknown. */
export class SubscriptionSubmissionError extends Error {
  readonly txSig: string;
  readonly phase: "broadcast" | "confirmation";

  constructor(txSig: string, phase: "broadcast" | "confirmation") {
    super(
      `Subscription transaction ${txSig} was signed, but its ${phase} outcome is unknown. `
      + "Keep the recovery sidecar and rerun the same command to check this public signature; "
      + "do not submit another subscription."
    );
    this.name = "SubscriptionSubmissionError";
    this.txSig = txSig;
    this.phase = phase;
  }
}

// Global fallback state populated by the first user for backwards compatibility
export const authState = {
  apiToken: '', // Long-lived B2B token
  jwt: ''        // Short-lived session token
};
let globalAuthGeneration = 0;

// Global lock for requests that do not specify a userName.
let globalRefreshPromise: Promise<string> | null = null;

// Map to handle concurrent multi-user states
export const userAuthMap = new Map<string, UserAuthState>();

function toSafeHttpError(error: unknown, operation: string): SafeHttpError {
  if (error instanceof SafeHttpError) return error;

  if (axios.isAxiosError(error)) {
    return new SafeHttpError(operation, error.response?.status, error.code);
  }

  return new SafeHttpError(operation);
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof SafeHttpError) return error.status;
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function httpCode(error: unknown): string | undefined {
  if (error instanceof SafeHttpError) return error.code;
  return axios.isAxiosError(error) ? error.code : undefined;
}

function isHeaderCredential(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]+$/.test(value);
}

function providedCredential(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!isHeaderCredential(value)) {
    throw new Error(`${label} must contain visible ASCII characters only.`);
  }
  return value;
}

function getOrStartJwtRefresh(name?: string): Promise<string> {
  const state = name ? userAuthMap.get(name) : undefined;
  const current = state?.refreshPromise ?? (!state ? globalRefreshPromise : null);
  if (current) return current;

  const refreshPromise = renewJwt(state ? name : undefined);

  if (state) {
    state.refreshPromise = refreshPromise;
    refreshPromise.then(
      () => {
        if (state.refreshPromise === refreshPromise) state.refreshPromise = null;
      },
      () => {
        if (state.refreshPromise === refreshPromise) state.refreshPromise = null;
      }
    );
  } else {
    globalRefreshPromise = refreshPromise;
    refreshPromise.then(
      () => {
        if (globalRefreshPromise === refreshPromise) globalRefreshPromise = null;
      },
      () => {
        if (globalRefreshPromise === refreshPromise) globalRefreshPromise = null;
      }
    );
  }

  return refreshPromise;
}

export async function renewJwt(name?: string): Promise<string> {
  const logName = name || "Global";
  console.log(`[Auth] JWT expired or missing for ${logName}. Acquiring new guest session...`);

  let newJwt: string;
  try {
    const response = await axios.post(config.JWT_URL, undefined, { timeout: 10_000 });
    if (!isHeaderCredential(response.data?.token)) {
      throw new SafeHttpError("Guest JWT issuance");
    }
    newJwt = response.data.token;
  } catch (error) {
    throw toSafeHttpError(error, "Guest JWT issuance");
  }

  if (name && userAuthMap.has(name)) {
    const state = userAuthMap.get(name)!;
    state.jwt = newJwt;
    state.authGeneration++;
  }
  
  // Populate default global state if this is the first user or a global request
  if (!name || userAuthMap.size === 1) {
    authState.jwt = newJwt;
    globalAuthGeneration++;
  }

  return newJwt;
}

export const apiClient = axios.create({
  baseURL: `${config.API_BASE_URL}`,
  timeout: 15_000,
});

// Request interceptor: Always inject the latest tokens
apiClient.interceptors.request.use(requestConfig => {
  const name = (requestConfig as any).userName as string | undefined;
  const state = name ? userAuthMap.get(name) : undefined;
  if (name && !state) {
    throw new Error(`Authentication state for ${name} is not initialized.`);
  }
  if (!name && userAuthMap.size > 1) {
    throw new Error("An unnamed API request is ambiguous when multiple user auth states exist.");
  }

  const jwt = state ? state.jwt : authState.jwt;
  const apiToken = state ? state.apiToken : authState.apiToken;
  (requestConfig as any)._authGeneration = state
    ? state.authGeneration
    : globalAuthGeneration;

  if (jwt && !isHeaderCredential(jwt)) {
    throw new Error("Guest JWT must contain visible ASCII characters only.");
  }
  if (apiToken && !isHeaderCredential(apiToken)) {
    throw new Error("API token must contain visible ASCII characters only.");
  }
  if (jwt) {
    requestConfig.headers['Authorization'] = `Bearer ${jwt}`;
  }
  if (apiToken) {
    requestConfig.headers['X-Api-Token'] = apiToken;
  }
  return requestConfig;
});

// Response interceptor: renew a guest JWT once for 401 only. A 403 is fatal.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config as ({ _jwtRetry?: boolean } & Record<string, any>) | undefined;
    const name = originalRequest?.userName as string | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._jwtRetry) {
      originalRequest._jwtRetry = true;

      try {
        const state = name ? userAuthMap.get(name) : undefined;
        const currentGeneration = state ? state.authGeneration : globalAuthGeneration;
        if (originalRequest._authGeneration === currentGeneration) {
          await getOrStartJwtRefresh(name);
        }
        return apiClient.request(originalRequest as any);
      } catch (refreshError) {
        console.error(`[Auth] Fatal: Could not renew JWT for ${name || "Global"}.`);
        return Promise.reject(toSafeHttpError(refreshError, "Guest JWT renewal"));
      }
    }

    return Promise.reject(toSafeHttpError(error, "API request"));
  }
);

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function validateSubscriptionInputs(serviceLevelId: number, weeks: number): void {
  if (!Number.isInteger(serviceLevelId) || serviceLevelId < 0 || serviceLevelId > 0xffff) {
    throw new Error(`Invalid service level ${serviceLevelId}: expected an unsigned 16-bit integer.`);
  }

  if (!Number.isInteger(weeks) || weeks < 0 || weeks > 0xff) {
    throw new Error(`Invalid subscription duration ${weeks}: expected an unsigned 8-bit integer.`);
  }

  if (weeks < 4 || weeks % 4 !== 0) {
    throw new Error(`Invalid subscription duration ${weeks}: expected at least 4 weeks in multiples of 4 (maximum 252).`);
  }
}

function validateSelectedLeagues(selectedLeagues: number[]): void {
  if (!Array.isArray(selectedLeagues) || selectedLeagues.some(
    league => !Number.isSafeInteger(league) || league < 0
  )) {
    throw new Error("Invalid leagues: expected an array of non-negative safe integers.");
  }
}

function validateTransactionSignature(txSig: string): void {
  if (typeof txSig !== "string" || txSig !== txSig.trim()) {
    throw new Error("Activation requires a valid base58 Solana transaction signature.");
  }
  try {
    const decoded = bs58.decode(txSig);
    if (decoded.length !== 64 || bs58.encode(decoded) !== txSig) throw new Error("invalid");
  } catch {
    throw new Error("Activation requires a canonical base58 64-byte Solana transaction signature.");
  }
}

function isCanonicalPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new anchor.web3.PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function isCanonicalBase58Identifier(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 16 || value.length > 96) return false;
  try {
    const decoded = bs58.decode(value);
    return decoded.length >= 16 && decoded.length <= 64 && bs58.encode(decoded) === value;
  } catch {
    return false;
  }
}

function subscriptionRecoveryPath(keypairLocation: string): string {
  const override = process.env.TXLINE_RECOVERY_FILE;
  if (override !== undefined) {
    if (override.length === 0 || /[\u0000\r\n]/.test(override)) {
      throw new Error("TXLINE_RECOVERY_FILE must be a non-empty filesystem path.");
    }
    return path.resolve(override);
  }
  return `${path.resolve(keypairLocation)}.txline-subscription-recovery.json`;
}

function validateRecoveryRecord(value: unknown): SubscriptionRecoveryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Subscription recovery record must be a JSON object.");
  }
  const object = value as Record<string, unknown>;
  const source = object.source;
  if (source !== "locally-signed" && source !== "provided") {
    throw new Error("Subscription recovery record has an unsupported source.");
  }
  const baseKeys = [
    "apiBaseUrl", "createdAt", "genesisHash", "programId", "schema", "selectedLeagues",
    "serviceLevelId", "source", "tokenMint", "txSig", "wallet", "weeks",
  ];
  const expectedKeys = source === "locally-signed"
    ? [...baseKeys, "lastValidBlockHeight", "recentBlockhash"].sort()
    : baseKeys.sort();
  const actualKeys = Object.keys(object).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Subscription recovery record has unexpected or missing fields.");
  }
  if (object.schema !== SUBSCRIPTION_RECOVERY_SCHEMA
    || !isCanonicalPublicKey(object.wallet)
    || !isCanonicalBase58Identifier(object.genesisHash)
    || !isCanonicalPublicKey(object.programId)
    || !isCanonicalPublicKey(object.tokenMint)
    || typeof object.apiBaseUrl !== "string"
    || typeof object.txSig !== "string"
    || typeof object.createdAt !== "string"
    || !Array.isArray(object.selectedLeagues)) {
    throw new Error("Subscription recovery record contains invalid public context.");
  }
  try {
    new URL(object.apiBaseUrl);
    if (new Date(object.createdAt).toISOString() !== object.createdAt) throw new Error("invalid date");
  } catch {
    throw new Error("Subscription recovery record contains an invalid URL or timestamp.");
  }
  validateTransactionSignature(object.txSig);
  validateSubscriptionInputs(object.serviceLevelId as number, object.weeks as number);
  validateSelectedLeagues(object.selectedLeagues as number[]);
  if (source === "locally-signed" && (
    !isCanonicalPublicKey(object.recentBlockhash)
    || !Number.isSafeInteger(object.lastValidBlockHeight)
    || (object.lastValidBlockHeight as number) < 0
  )) {
    throw new Error("Subscription recovery record contains invalid blockhash context.");
  }
  return object as SubscriptionRecoveryRecord;
}

async function readSubscriptionRecovery(
  recoveryPath: string,
): Promise<SubscriptionRecoveryRecord | undefined> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(recoveryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_192) {
    throw new Error("Subscription recovery path must be a regular JSON file no larger than 8 KiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.promises.readFile(recoveryPath, "utf8"));
  } catch {
    throw new Error("Subscription recovery record is not valid JSON.");
  }
  return validateRecoveryRecord(parsed);
}

type SubscriptionRecoveryLock = {
  handle: Awaited<ReturnType<typeof fs.promises.open>>;
  lockPath: string;
  released: boolean;
};

async function acquireSubscriptionRecoveryLock(
  recoveryPath: string,
): Promise<SubscriptionRecoveryLock> {
  await fs.promises.mkdir(path.dirname(recoveryPath), { recursive: true });
  const lockPath = `${recoveryPath}.lock`;
  let handle: Awaited<ReturnType<typeof fs.promises.open>>;
  try {
    handle = await fs.promises.open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Subscription recovery lock already exists at ${lockPath}; refusing to submit another transaction.`,
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.promises.unlink(lockPath).catch(() => undefined);
    throw error;
  }
  return { handle, lockPath, released: false };
}

async function releaseSubscriptionRecoveryLock(lock: SubscriptionRecoveryLock): Promise<void> {
  if (lock.released) return;
  lock.released = true;
  await lock.handle.close();
  try {
    await fs.promises.unlink(lock.lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function syncParentDirectory(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  const directory = await fs.promises.open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function writeSubscriptionRecovery(
  recoveryPath: string,
  record: SubscriptionRecoveryRecord,
): Promise<void> {
  if (await readSubscriptionRecovery(recoveryPath)) {
    throw new Error("A subscription recovery record already exists; refusing to overwrite it.");
  }
  const temporaryPath = `${recoveryPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await fs.promises.open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.rename(temporaryPath, recoveryPath);
    await syncParentDirectory(recoveryPath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function assertRecoveryContext(
  record: SubscriptionRecoveryRecord,
  context: SubscriptionRecoveryContext,
  providedTxSig: string | undefined,
): void {
  const mismatches: string[] = [];
  const scalarKeys: Array<keyof Omit<SubscriptionRecoveryContext, "selectedLeagues">> = [
    "wallet", "genesisHash", "programId", "tokenMint", "apiBaseUrl", "serviceLevelId", "weeks",
  ];
  for (const key of scalarKeys) {
    if (record[key] !== context[key]) mismatches.push(key);
  }
  if (JSON.stringify(record.selectedLeagues) !== JSON.stringify(context.selectedLeagues)) {
    mismatches.push("selectedLeagues");
  }
  if (providedTxSig !== undefined && record.txSig !== providedTxSig) mismatches.push("txSig");
  if (mismatches.length > 0) {
    throw new Error(
      `Subscription recovery does not match the current ${mismatches.join(", ")}; `
      + "the existing record was retained and no transaction was submitted.",
    );
  }
}

async function requireConfirmedRecovery(
  connection: Pick<anchor.web3.Connection, "getSignatureStatuses">,
  record: SubscriptionRecoveryRecord,
  name: string,
): Promise<void> {
  let status: Awaited<ReturnType<anchor.web3.Connection["getSignatureStatuses"]>>["value"][number];
  try {
    const response = await connection.getSignatureStatuses(
      [record.txSig],
      { searchTransactionHistory: true },
    );
    status = response.value[0];
  } catch {
    throw new Error(
      `[${name}] Could not verify subscription transaction ${record.txSig}; `
      + "the recovery record was retained and no transaction was submitted.",
    );
  }
  if (!status) {
    throw new Error(
      `[${name}] Subscription transaction ${record.txSig} is not confirmed; `
      + "the recovery record was retained and no transaction was submitted.",
    );
  }
  if (status.err) {
    throw new Error(
      `[${name}] Subscription transaction ${record.txSig} failed on-chain; `
      + "the recovery record was retained and no transaction was submitted.",
    );
  }
  if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") {
    throw new Error(
      `[${name}] Subscription transaction ${record.txSig} is only processed, not confirmed; `
      + "the recovery record was retained and no transaction was submitted.",
    );
  }
}

async function tryFetchUserTokenAccount(
  connection: anchor.web3.Connection,
  userTokenAccountAddress: anchor.web3.PublicKey
): Promise<Account | undefined> {
  try {
    return await getAccount(
      connection,
      userTokenAccountAddress,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
  } catch {
    return undefined;
  }
}

export async function broadcastAndConfirmSubscription(
  connection: Pick<anchor.web3.Connection, "sendRawTransaction" | "confirmTransaction">,
  tx: anchor.web3.Transaction,
  latestBlockhash: Readonly<{ blockhash: string; lastValidBlockHeight: number }>,
  name: string,
  beforeBroadcast?: BeforeSubscriptionBroadcast,
): Promise<string> {
  if (!tx.signature || tx.signature.length !== 64) {
    throw new Error(`[${name}] Signed subscription transaction has no canonical signature.`);
  }
  const txSig = bs58.encode(tx.signature);
  const serialized = tx.serialize();
  if (beforeBroadcast) await beforeBroadcast(txSig, latestBlockhash);

  let rpcSignature: string;
  try {
    rpcSignature = await connection.sendRawTransaction(serialized);
  } catch {
    throw new SubscriptionSubmissionError(txSig, "broadcast");
  }
  if (rpcSignature !== txSig) {
    throw new SubscriptionSubmissionError(txSig, "broadcast");
  }

  let confirmation: Awaited<ReturnType<typeof connection.confirmTransaction>>;
  try {
    confirmation = await connection.confirmTransaction({
      signature: txSig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, "confirmed");
  } catch {
    throw new SubscriptionSubmissionError(txSig, "confirmation");
  }

  if (confirmation.value.err) {
    throw new Error(`[${name}] Subscription transaction was confirmed with an execution error.`);
  }
  return txSig;
}

/**
 * Submit and confirm exactly one subscription transaction. Activation is a
 * separate operation so callers retain the public txSig if the backend is down.
 */
export async function submitSubscription(
  name: string,
  user: anchor.web3.Keypair,
  tokenMint: anchor.web3.PublicKey,
  connection: anchor.web3.Connection,
  program: anchor.Program<Txoracle>,
  serviceLevelId: number,
  weeks: number,
  beforeBroadcast: BeforeSubscriptionBroadcast,
): Promise<SubscriptionConfirmation> {
  validateSubscriptionInputs(serviceLevelId, weeks);

  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint,
    user.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const [pricingMatrixPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );

  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  console.log(`Pricing matrix by authority: ${matrix.admin.toBase58()}`);
  console.log("Service level id.  Tokens/week   Sampling (sec)  League bundle  Market bundle");
  console.log("=================   ===========   ==============  =============  =============");
  matrix.rows.forEach((row: any) => {
    console.log(
      String(row.rowId).padStart(12, " ")
      + String(row.pricePerWeekToken).padStart(17, " ")
      + String(row.samplingIntervalSec).padStart(15, " ")
      + String(row.leagueBundleId).padStart(15, " ")
      + String(row.marketBundleId).padStart(12, " ")
    );
  });
  if (!matrix.rows.some((row: any) => row.rowId === serviceLevelId)) {
    throw new Error(`Service level ${serviceLevelId} is not present in the current pricing matrix.`);
  }

  const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);
  if (!accountInfo) {
    console.log(`[${name}] Creating User Token-2022 Account`);
    const transaction = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userTokenAccountAddress,
        user.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    await anchor.web3.sendAndConfirmTransaction(
      connection,
      transaction,
      [user],
      { commitment: "confirmed" }
    );
    console.log(`[${name}] Account created`);
    await delay(3_000);
  }

  let userTokenAccount: Account | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      userTokenAccount = await getAccount(
        connection,
        userTokenAccountAddress,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TokenAccountNotFoundError") throw error;
      if (attempt === 5) break;
      console.log(`[${name}] RPC not synced. Retrying (${attempt}/5)...`);
      await delay(2_000);
    }
  }

  if (!userTokenAccount) {
    throw new Error(`[${name}] RPC failed to sync the new token account.`);
  }

  const [tokenTreasuryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(`[${name}] Subscribing on-chain: Level ${serviceLevelId}, Duration ${weeks} weeks`);
  const tx = await program.methods
    .subscribe(serviceLevelId, weeks)
    .accounts({
      user: user.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = user.publicKey;
  tx.sign(user);

  const txSig = await broadcastAndConfirmSubscription(
    connection,
    tx,
    latestBlockhash,
    name,
    beforeBroadcast,
  );

  console.log(`[${name}] Transaction confirmed: ${txSig}`);
  return { txSig, userTokenAccount };
}

function createActivationSignature(
  user: anchor.web3.Keypair,
  txSig: string,
  selectedLeagues: number[],
  jwt: string
): string {
  // The JWT is part of the signed preimage, so this must run after every renewal.
  const preimage = `${txSig}:${selectedLeagues.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(new TextEncoder().encode(preimage), user.secretKey);

  if (signatureBytes.length !== 64) {
    throw new Error("Activation signing failed: detached Ed25519 signature was not 64 bytes.");
  }

  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");
  if (Buffer.from(signatureBase64, "base64").length !== 64) {
    throw new Error("Activation signing failed: invalid base64 signature encoding.");
  }

  return signatureBase64;
}

/** Activate a confirmed txSig without submitting any on-chain transaction. */
export async function activateSubscription(options: ActivationOptions): Promise<string> {
  const {
    name,
    user,
    txSig,
    selectedLeagues,
    maxTransientRetries = 2,
    retryBaseDelayMs = 500,
  } = options;

  validateTransactionSignature(txSig);
  validateSelectedLeagues(selectedLeagues);
  if (!Number.isInteger(maxTransientRetries) || maxTransientRetries < 0 || maxTransientRetries > 5) {
    throw new Error("maxTransientRetries must be an integer from 0 through 5.");
  }
  if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 100 || retryBaseDelayMs > 10_000) {
    throw new Error("retryBaseDelayMs must be an integer from 100 through 10000.");
  }

  const userState = userAuthMap.get(name);
  if (!userState?.jwt) {
    throw new Error(`Activation requires an initialized guest JWT for ${name}.`);
  }

  let renewedJwt = false;
  let transientRetries = 0;
  const activationUrl = `${config.API_BASE_URL}/token/activate`;

  while (true) {
    const walletSignature = createActivationSignature(
      user,
      txSig,
      selectedLeagues,
      userState.jwt
    );

    try {
      const response = await axios.post(
        activationUrl,
        { txSig, walletSignature, leagues: selectedLeagues },
        {
          headers: { Authorization: `Bearer ${userState.jwt}` },
          timeout: 15_000,
        }
      );
      const apiToken = typeof response.data === "string" ? response.data : response.data?.token;
      if (!isHeaderCredential(apiToken)) {
        throw new SafeHttpError("Subscription activation");
      }
      userState.apiToken = apiToken;
      if (userState.confirmedTxSig === txSig) delete userState.confirmedTxSig;
      if (userState.submittedTxSig === txSig) delete userState.submittedTxSig;
      if (userAuthMap.size === 1) authState.apiToken = apiToken;
      return apiToken;
    } catch (error) {
      const status = httpStatus(error);
      const code = httpCode(error);

      if (status === 401 && !renewedJwt) {
        renewedJwt = true;
        console.log(`[${name}] Activation JWT rejected; renewing once and re-signing the activation preimage.`);
        await getOrStartJwtRefresh(name);
        continue;
      }

      const transientNetworkFailure = status === undefined
        && (code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ECONNRESET");
      const transientServerFailure = status !== undefined && status >= 500 && status <= 599;
      if ((transientNetworkFailure || transientServerFailure) && transientRetries < maxTransientRetries) {
        transientRetries++;
        const waitMs = retryBaseDelayMs * (2 ** (transientRetries - 1));
        const reason = status === undefined ? "a transient network error" : `HTTP ${status}`;
        console.log(
          `[${name}] Activation returned ${reason}; retrying in ${waitMs}ms `
          + `(${transientRetries}/${maxTransientRetries}).`
        );
        await delay(waitMs);
        continue;
      }

      // All 4xx responses (especially 400/403) and exhausted transient failures stop here.
      throw toSafeHttpError(error, "Subscription activation");
    }
  }
}

/**
 * Set up authenticated access. A provided API token bypasses subscription and
 * activation. existingTxSig (or TXLINE_TX_SIG) performs activation only.
 */
export async function setupUser(
  name: string,
  keypairLocation: string,
  tokenMint: anchor.web3.PublicKey,
  connection: anchor.web3.Connection,
  program: anchor.Program<Txoracle>,
  serviceLevelId: number,
  weeks: number,
  selectedLeagues: number[],
  existingJwt?: string,
  existingApiToken?: string,
  existingTxSig?: string
): Promise<User> {
  let user: anchor.web3.Keypair;
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    user = anchor.web3.Keypair.fromSecretKey(secretKey);
  } catch {
    throw new Error(`[${name}] Could not load user keypair at ${keypairLocation}.`);
  }
  validateSubscriptionInputs(serviceLevelId, weeks);
  validateSelectedLeagues(selectedLeagues);
  const normalizedExistingJwt = providedCredential(existingJwt, "Provided guest JWT");
  const normalizedExistingApiToken = providedCredential(existingApiToken, "Provided API token");

  let userState = userAuthMap.get(name);
  if (!userState) {
    userState = {
      apiToken: normalizedExistingApiToken || "",
      jwt: normalizedExistingJwt || "",
      refreshPromise: null,
      authGeneration: 0,
    };
    userAuthMap.set(name, userState);
  } else {
    if (normalizedExistingJwt && normalizedExistingJwt !== userState.jwt) {
      userState.jwt = normalizedExistingJwt;
      userState.authGeneration++;
    }
    if (normalizedExistingApiToken) userState.apiToken = normalizedExistingApiToken;
  }

  if (!userState.jwt) {
    await getOrStartJwtRefresh(name);
  } else {
    console.log(`[${name}] Using provided JWT.`);
  }

  if (userAuthMap.size === 1) {
    authState.jwt = userState.jwt;
    authState.apiToken = userState.apiToken;
    globalAuthGeneration = userState.authGeneration;
  }

  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint,
    user.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  if (userState.apiToken) {
    console.log(`[${name}] Existing API Token detected. Bypassing subscription and activation.`);
    return {
      user,
      userTokenAccount: await tryFetchUserTokenAccount(connection, userTokenAccountAddress),
      activationStatus: "api-token-bypass",
    };
  }

  const providedTxSig = existingTxSig
    ?? process.env.TXLINE_TX_SIG
    ?? userState.confirmedTxSig
    ?? userState.submittedTxSig;
  // A present-but-invalid recovery value must fail closed, never fall through to subscribe.
  if (providedTxSig !== undefined) validateTransactionSignature(providedTxSig);

  const recoveryPath = subscriptionRecoveryPath(keypairLocation);
  const genesisHash = await connection.getGenesisHash();
  if (!isCanonicalBase58Identifier(genesisHash)) {
    throw new Error("RPC returned a non-canonical genesis hash; refusing subscription recovery.");
  }
  const recoveryContext: SubscriptionRecoveryContext = {
    wallet: user.publicKey.toBase58(),
    genesisHash,
    programId: program.programId.toBase58(),
    tokenMint: tokenMint.toBase58(),
    apiBaseUrl: config.API_BASE_URL,
    serviceLevelId,
    weeks,
    selectedLeagues: [...selectedLeagues],
  };
  const loadRecovery = async (): Promise<SubscriptionRecoveryRecord | undefined> => {
    const record = await readSubscriptionRecovery(recoveryPath);
    if (record) assertRecoveryContext(record, recoveryContext, providedTxSig);
    return record;
  };

  let recovery = await loadRecovery();
  if (!recovery && providedTxSig !== undefined) {
    const lock = await acquireSubscriptionRecoveryLock(recoveryPath);
    try {
      recovery = await loadRecovery();
      if (!recovery) {
        recovery = {
          ...recoveryContext,
          schema: SUBSCRIPTION_RECOVERY_SCHEMA,
          source: "provided",
          txSig: providedTxSig,
          createdAt: new Date().toISOString(),
        };
        await writeSubscriptionRecovery(recoveryPath, recovery);
      }
    } finally {
      await releaseSubscriptionRecoveryLock(lock);
    }
  }

  let txSig = "";
  let userTokenAccount: Account | undefined;

  if (recovery) {
    await requireConfirmedRecovery(connection, recovery, name);
    txSig = recovery.txSig;
    console.log(`[${name}] Reusing confirmed transaction ${txSig}; no subscription will be submitted.`);
    userTokenAccount = await tryFetchUserTokenAccount(connection, userTokenAccountAddress);
  } else {
    let lock: SubscriptionRecoveryLock | undefined = await acquireSubscriptionRecoveryLock(recoveryPath);
    try {
      const racedRecovery = await loadRecovery();
      if (racedRecovery) {
        await releaseSubscriptionRecoveryLock(lock);
        lock = undefined;
        await requireConfirmedRecovery(connection, racedRecovery, name);
        txSig = racedRecovery.txSig;
        userTokenAccount = await tryFetchUserTokenAccount(connection, userTokenAccountAddress);
      } else {
        const confirmation = await submitSubscription(
          name,
          user,
          tokenMint,
          connection,
          program,
          serviceLevelId,
          weeks,
          async (signedTxSig, latestBlockhash) => {
            await writeSubscriptionRecovery(recoveryPath, {
              ...recoveryContext,
              schema: SUBSCRIPTION_RECOVERY_SCHEMA,
              source: "locally-signed",
              txSig: signedTxSig,
              createdAt: new Date().toISOString(),
              recentBlockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            });
            await releaseSubscriptionRecoveryLock(lock!);
            lock = undefined;
          },
        );
        txSig = confirmation.txSig;
        userTokenAccount = confirmation.userTokenAccount;
      }
    } catch (error) {
      if (error instanceof SubscriptionSubmissionError) {
        userState.submittedTxSig = error.txSig;
      }
      throw error;
    } finally {
      if (lock) await releaseSubscriptionRecoveryLock(lock);
    }
  }
  userState.confirmedTxSig = txSig;
  delete userState.submittedTxSig;

  console.log(`[${name}] Activating confirmed subscription transaction.`);
  try {
    userState.apiToken = await activateSubscription({ name, user, txSig, selectedLeagues });
  } catch (error) {
    throw new SubscriptionActivationError(
      txSig,
      toSafeHttpError(error, "Subscription activation")
    );
  }

  console.log(
    `[${name}] Activation succeeded; retaining the public recovery record to prevent `
    + "a duplicate subscription after restart.",
  );

  if (userAuthMap.size === 1) authState.apiToken = userState.apiToken;

  return {
    user,
    userTokenAccount,
    txSig,
    activationStatus: "activated",
  };
}
