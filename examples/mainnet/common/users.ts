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
    if (typeof response.data?.token !== "string" || response.data.token.length === 0) {
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
  weeks: number
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

  const txSig = await connection.sendRawTransaction(tx.serialize());
  const confirmation = await connection.confirmTransaction({
    signature: txSig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  if (confirmation.value.err) {
    throw new Error(`[${name}] Subscription transaction was not confirmed successfully.`);
  }

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
      if (typeof apiToken !== "string" || apiToken.length === 0) {
        throw new SafeHttpError("Subscription activation");
      }
      userState.apiToken = apiToken;
      if (userState.confirmedTxSig === txSig) delete userState.confirmedTxSig;
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
  validateSelectedLeagues(selectedLeagues);

  let userState = userAuthMap.get(name);
  if (!userState) {
    userState = {
      apiToken: existingApiToken || "",
      jwt: existingJwt || "",
      refreshPromise: null,
      authGeneration: 0,
    };
    userAuthMap.set(name, userState);
  } else {
    if (existingJwt && existingJwt !== userState.jwt) {
      userState.jwt = existingJwt;
      userState.authGeneration++;
    }
    if (existingApiToken) userState.apiToken = existingApiToken;
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

  const providedTxSig = existingTxSig ?? process.env.TXLINE_TX_SIG ?? userState.confirmedTxSig;
  const activationOnlyTxSig = providedTxSig?.trim() ?? "";
  // A present-but-invalid recovery value must fail closed, never fall through to subscribe.
  if (providedTxSig !== undefined) validateTransactionSignature(activationOnlyTxSig);
  let txSig = activationOnlyTxSig;
  let userTokenAccount: Account | undefined;

  if (txSig) {
    console.log(`[${name}] Reusing confirmed transaction ${txSig}; no subscription will be submitted.`);
    userTokenAccount = await tryFetchUserTokenAccount(connection, userTokenAccountAddress);
  } else {
    const confirmation = await submitSubscription(
      name,
      user,
      tokenMint,
      connection,
      program,
      serviceLevelId,
      weeks
    );
    txSig = confirmation.txSig;
    userTokenAccount = confirmation.userTokenAccount;
  }
  userState.confirmedTxSig = txSig;

  console.log(`[${name}] Activating confirmed subscription transaction.`);
  try {
    userState.apiToken = await activateSubscription({ name, user, txSig, selectedLeagues });
  } catch (error) {
    throw new SubscriptionActivationError(
      txSig,
      toSafeHttpError(error, "Subscription activation")
    );
  }

  if (userAuthMap.size === 1) authState.apiToken = userState.apiToken;

  return {
    user,
    userTokenAccount,
    txSig,
    activationStatus: "activated",
  };
}
