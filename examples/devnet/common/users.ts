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
import { PublicKey, Transaction } from "@solana/web3.js";

export type User = {
  user: anchor.web3.Keypair,
  userTokenAccount: Account | undefined
}

export type UserAuthState = {
  apiToken: string;
  jwt: string;
  refreshPromise: Promise<string> | null;
  authGeneration: number;
};

export type ActivationOptions = {
  name: string;
  user: anchor.web3.Keypair;
  txSig: string;
  selectedLeagues: number[];
  maxTransientRetries?: number;
  retryBaseDelayMs?: number;
};

/** Public error shape for auth failures; it never carries request headers or response bodies. */
export class SafeHttpError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(operation: string, status?: number, code?: string) {
    super(`${operation} failed${status === undefined ? (code ? ` (${code})` : "") : ` with HTTP ${status}`}`);
    this.name = "SafeHttpError";
    this.status = status;
    this.code = code;
  }
}

const JWT_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 15_000;

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

function toSafeHttpError(error: unknown, operation: string): SafeHttpError {
  if (error instanceof SafeHttpError) return error;
  if (axios.isAxiosError(error)) {
    return new SafeHttpError(operation, error.response?.status, error.code);
  }
  return new SafeHttpError(operation);
}

function getOrStartJwtRefresh(name?: string): Promise<string> {
  const state = name ? userAuthMap.get(name) : undefined;
  if (name && !state) {
    return Promise.reject(new Error(`Authentication state for ${name} is not initialized.`));
  }

  const current = state?.refreshPromise ?? (!state ? globalRefreshPromise : null);
  if (current) return current;

  const refreshPromise = renewJwt(name);
  if (state) {
    state.refreshPromise = refreshPromise;
  } else {
    globalRefreshPromise = refreshPromise;
  }

  refreshPromise.then(
    () => {
      if (state?.refreshPromise === refreshPromise) state.refreshPromise = null;
      if (!state && globalRefreshPromise === refreshPromise) globalRefreshPromise = null;
    },
    () => {
      if (state?.refreshPromise === refreshPromise) state.refreshPromise = null;
      if (!state && globalRefreshPromise === refreshPromise) globalRefreshPromise = null;
    },
  );

  return refreshPromise;
}

export async function renewJwt(name?: string): Promise<string> {
  const logName = name || "Global";
  console.log(`[Auth] JWT expired or missing for ${logName}. Acquiring new guest session...`);

  let newJwt: string;
  try {
    const response = await axios.post(config.JWT_URL, undefined, { timeout: JWT_TIMEOUT_MS });
    newJwt = response.data?.token;
    if (!isHeaderCredential(newJwt)) throw new Error("invalid token response");
  } catch (error) {
    throw toSafeHttpError(error, "Guest JWT issuance");
  }

  if (name) {
    const state = userAuthMap.get(name);
    if (!state) {
      throw new Error(`Authentication state for ${name} is not initialized.`);
    }
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
  timeout: API_TIMEOUT_MS,
});

// Request interceptor: Always inject the latest tokens
apiClient.interceptors.request.use(requestConfig => {
  const name = (requestConfig as any).userName as string | undefined;
  const state = name ? userAuthMap.get(name) : undefined;
  if (name && !state) {
    throw new Error(`Authentication state for ${name} is not initialized.`);
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

// Renew a guest JWT once for 401 only. A 403 and a replayed 401 are terminal.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config as
      | ({ _jwtRetry?: boolean; _authGeneration?: number; userName?: string } & Record<string, any>)
      | undefined;
    const name = originalRequest?.userName;

    if (error.response?.status === 401 && originalRequest && !originalRequest._jwtRetry) {
      originalRequest._jwtRetry = true;

      try {
        const state = name ? userAuthMap.get(name) : undefined;
        if (name && !state) {
          throw new Error(`Authentication state for ${name} is not initialized.`);
        }
        const currentGeneration = state ? state.authGeneration : globalAuthGeneration;
        if (originalRequest._authGeneration === currentGeneration) {
          await getOrStartJwtRefresh(name);
        }
        return apiClient.request(originalRequest as any);
      } catch (refreshError) {
        const safe = toSafeHttpError(refreshError, "Guest JWT renewal");
        console.error(`[Auth] JWT renewal failed for ${name || "Global"} (${safe.status ?? safe.code ?? "unknown error"}).`);
        return Promise.reject(safe);
      }
    }

    return Promise.reject(error);
  }
);

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function createActivationSignature(
  user: anchor.web3.Keypair,
  txSig: string,
  selectedLeagues: number[],
  jwt: string,
): string {
  const preimage = `${txSig}:${selectedLeagues.join(",")}:${jwt}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(preimage), user.secretKey);
  return Buffer.from(signature).toString("base64");
}

function isTransientActivationError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status !== undefined) return status >= 500 && status <= 599;
  return ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ERR_NETWORK"].includes(error.code || "");
}

export async function activateSubscription(options: ActivationOptions): Promise<string> {
  const {
    name,
    user,
    txSig,
    selectedLeagues,
    maxTransientRetries = 2,
    retryBaseDelayMs = 500,
  } = options;

  if (!Number.isInteger(maxTransientRetries) || maxTransientRetries < 0 || maxTransientRetries > 5) {
    throw new Error("maxTransientRetries must be an integer from 0 through 5.");
  }
  if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 0 || retryBaseDelayMs > 10_000) {
    throw new Error("retryBaseDelayMs must be an integer from 0 through 10000.");
  }

  const userState = userAuthMap.get(name);
  if (!userState || !isHeaderCredential(userState.jwt)) {
    throw new Error(`Activation requires a valid guest JWT for ${name}.`);
  }

  let renewedJwt = false;
  let transientRetries = 0;
  const activationUrl = `${config.API_BASE_URL}/token/activate`;

  while (true) {
    const jwt = userState.jwt;
    const walletSignature = createActivationSignature(user, txSig, selectedLeagues, jwt);

    try {
      const response = await axios.post(
        activationUrl,
        { txSig, walletSignature, leagues: selectedLeagues },
        {
          headers: { Authorization: `Bearer ${jwt}` },
          timeout: API_TIMEOUT_MS,
        },
      );
      const apiToken = typeof response.data === "string" ? response.data : response.data?.token;
      if (!isHeaderCredential(apiToken)) {
        throw new Error("Subscription activation returned an invalid API token.");
      }
      userState.apiToken = apiToken;
      if (userAuthMap.size === 1) authState.apiToken = apiToken;
      return apiToken;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 401 && !renewedJwt) {
        renewedJwt = true;
        console.log(`[${name}] Activation JWT rejected; renewing once and re-signing.`);
        await getOrStartJwtRefresh(name);
        continue;
      }

      if (isTransientActivationError(error) && transientRetries < maxTransientRetries) {
        const waitMs = retryBaseDelayMs * (2 ** transientRetries);
        transientRetries++;
        console.log(
          `[${name}] Activation transient failure; retrying in ${waitMs}ms `
          + `(${transientRetries}/${maxTransientRetries}).`,
        );
        await delay(waitMs);
        continue;
      }

      throw toSafeHttpError(error, "Subscription activation");
    }
  }
}

/**
 * Set up a user with tokens and perform a subscription use case.
 * Optional existingJwt and existingApiToken could be used to bypass acquisition.
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
  existingApiToken?: string 
): Promise<User> {
  const normalizedExistingJwt = providedCredential(existingJwt, "Provided guest JWT");
  const normalizedExistingApiToken = providedCredential(existingApiToken, "Provided API token");
  let user: anchor.web3.Keypair;
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    user = anchor.web3.Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.error(`[${name}] Could not load user keypair at ${keypairLocation}`);
    throw err;
  }

  // Initialize the user auth state
  let userState = userAuthMap.get(name);
  if (!userState) {
    userState = {
      apiToken: normalizedExistingApiToken || '',
      jwt: normalizedExistingJwt || '',
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

  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID
  );

  const [pricingMatrixPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);
  
  // Fetch and display the service tier pricing matrix
  async function discoverPricingMatrix() {
    const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
    console.log(`Pricing matrix by authority: ${matrix.admin.toBase58()}`); 
    console.log(`Service level id.  Tokens/week   Sampling (sec)  League bundle  Market bundle`);
    console.log(`=================   ===========   ==============  =============  =============`);

    matrix.rows.forEach((row: any) => {
      console.log(
        String(row.rowId).padStart(12, " ")
        + String(row.pricePerWeekToken).padStart(17, " ")
        + String(row.samplingIntervalSec).padStart(15, " ")
        + String(row.leagueBundleId).padStart(15, " ")
        + String(row.marketBundleId).padStart(12, " ")
      );
    });        
  }
  
  await discoverPricingMatrix();

  // Ensure we have a JWT for backend requests
  if (!userState.jwt) {
    console.log(`[${name}] No existing JWT. Acquiring new guest session...`);
    await getOrStartJwtRefresh(name);
  } else {
    console.log(`[${name}] Using provided JWT.`);
  }

  // Populate default global state if this is the first user
  if (userAuthMap.size === 1) {
    if (authState.jwt !== userState.jwt) globalAuthGeneration++;
    authState.jwt = userState.jwt;
    authState.apiToken = userState.apiToken;
  }

  // If the API Token exists, the user has already paid. Bypass on-chain and activation flows.
  if (userState.apiToken) {
    console.log(`[${name}] Existing API Token detected. Bypassing on-chain payment and backend activation.`);
    
    let userTokenAccount;
    try {
      // Attempt to fetch the account to populate the return object, but do not crash if network is laggy
      userTokenAccount = await getAccount(
        connection,
        userTokenAccountAddress,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
    } catch (e) {
      console.log(`[${name}] Note: Could not fetch Token-2022 account on-chain. Assuming it exists.`);
    }

    return {
      user: user,
      userTokenAccount: userTokenAccount
    };
  }

  // Standard subscription flow
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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
    
    await anchor.web3.sendAndConfirmTransaction(connection, transaction, [user], { commitment: "confirmed" });
    console.log(`[${name}] Account created`);
    await delay(3000); 
  }

  let userTokenAccount;
  let attempts = 0;
  while (attempts < 5) {
    try {
      userTokenAccount = await getAccount(connection, userTokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
      break; 
    } catch (err: any) {
      if (err.name === 'TokenAccountNotFoundError') {
        attempts++;
        console.log(`[${name}] RPC not synced. Retrying (${attempts}/5)...`);
        await delay(2000);
      } else {
        throw err; 
      }
    }
  }

  if (!userTokenAccount) {
    throw new Error(`[${name}] RPC failed to sync the new token account.`);
  }

  const [tokenTreasuryPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], program.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(tokenMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID);

  if (weeks < 4 || weeks % 4 !== 0) {
    throw new Error(`Invalid subscription duration: ${weeks} weeks. Must be a multiple of 4.`);
  }

  console.log(`[${name}] Subscribing on-chain: Level ${serviceLevelId}, Duration ${weeks} weeks`);

  let tx: anchor.web3.Transaction;

  tx = await program.methods
    .subscribe(serviceLevelId, weeks)
    .accounts({
      user: user.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault: tokenTreasuryVault,
      tokenTreasuryPda: tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = user.publicKey;
  tx.sign(user);

  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({
    signature: txSig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, 'confirmed');

  console.log(`[${name}] Transaction confirmed: ${txSig}`);
  console.log(`[${name}] Acquiring API Token via activation endpoint...`);
  await activateSubscription({ name, user, txSig, selectedLeagues });

  return {
    user: user,
    userTokenAccount: userTokenAccount
  };
}

// Verify a decoded transaction to ensure it is safe to sign
export function verifyTransactionSafety(
  transaction: Transaction,
  expectedBuyer: PublicKey,
  program: anchor.Program<any>,
  expectedAmount: anchor.BN
): void {
  
  // Verify the expected fee payer
  if (!transaction.feePayer || !transaction.feePayer.equals(expectedBuyer)) {
    throw new Error("Safety check failed: Fee payer is not the expected buyer wallet");
  }

  // Ensure the backend admin has already signed the transaction
  const hasAdminSignature = transaction.signatures.some(
    sig => sig.signature !== null && !sig.publicKey.equals(expectedBuyer)
  );
  if (!hasAdminSignature) {
    throw new Error("Safety check failed: Missing backend admin signature");
  }

  // Whitelist permitted programs that the transaction can invoke
  const allowedPrograms = [
    program.programId.toBase58(),
    "ComputeBudget111111111111111111111111111111", 
    "11111111111111111111111111111111",              
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"  
  ];

  let oracleInstructionCount = 0;

  // Inspect every instruction in the payload
  transaction.instructions.forEach(instruction => {
    const programId = instruction.programId.toBase58();
    
    // Halt execution if an unknown or malicious program is detected
    if (!allowedPrograms.includes(programId)) {
      throw new Error(`Safety check failed: Unauthorized program invocation detected ${programId}`);
    }

    // Verify that the buyer is not inadvertently set as a signer on rogue accounts
    instruction.keys.forEach(keyMeta => {
      if (keyMeta.isSigner && keyMeta.pubkey.equals(expectedBuyer)) {
        // Enforce that the buyer only signs for authorized logic
        const isAuthorizedSigner = programId === program.programId.toBase58() || programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        if (!isAuthorizedSigner) {
           throw new Error(`Safety check failed: Buyer wallet requested as signer for unauthorized program ${programId}`);
        }
      }
    });

    // Decode and verify the specific oracle business logic
    if (programId === program.programId.toBase58()) {
      oracleInstructionCount++;

      const decodedIx = (program.coder.instruction as anchor.BorshInstructionCoder).decode(
        instruction.data
      );

      if (!decodedIx) {
        throw new Error("Safety check failed: Could not decode instruction data");
      }

      // Verify the correct function execution
      if (decodedIx.name !== "purchaseSubscriptionTokenUsdt") {
        throw new Error(`Safety check failed: Server attempted to execute unauthorized function: ${decodedIx.name}`);
      }

      // Extract and verify the exact requested amount
      const payloadAmount = (decodedIx.data as any).txlineAmount as anchor.BN;

      if (!payloadAmount.eq(expectedAmount)) {
        throw new Error(
          `Safety check failed: Amount mismatch! Bot requested ${expectedAmount.toString()}, but server payload contains ${payloadAmount.toString()}`
        );
      }
    }
  });

  // Prevent empty payloads that charge gas but do nothing
  if (oracleInstructionCount === 0) {
    throw new Error("Safety check failed: No Oracle instruction found in payload");
  }

  // Prevent malicious payload stuffing
  if (oracleInstructionCount > 1) {
    throw new Error("Safety check failed: Multiple Oracle instructions detected in payload");
  }
}
