import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Account,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token"
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage
} from "@solana/web3.js";
import * as config from './config';
import * as fs from "fs";
import axios from "axios";
import nacl from "tweetnacl";
import BN from "bn.js";
import { buildInstruction } from "../../common/utils/instructionBuilders";
import { decodeInstruction, parseInstructionArgs } from "../../common/utils/borshCodec";
import { convertSnakeToCamel } from "../../common/utils/caseConversion";
import * as tokenCache from "../../common/utils/tokenCache";

export type User = {
  user: Keypair,
  userTokenAccount: Account | undefined
}

export type UserAuthState = {
  apiToken: string;
  jwt: string;
  isRefreshing: boolean;
  refreshSubscribers: ((token: string) => void)[];
};

// Global fallback state populated by the first user for backwards compatibility
export const authState = {
  apiToken: '', // Long-lived B2B token
  jwt: ''        // Short-lived session token
};

// Global locks for requests that do not specify a userName
let globalIsRefreshing = false;
let globalRefreshSubscribers: ((token: string) => void)[] = [];

// Map to handle concurrent multi-user states
export const userAuthMap = new Map<string, UserAuthState>();

// Map to track keypair paths for token cache invalidation
const userKeypairMap = new Map<string, string>();

// Map to track which users are using cached tokens (vs. explicitly provided)
const usersWithCachedToken = new Set<string>();

function getAuthState(name: string | undefined): UserAuthState | undefined {
  return name && userAuthMap.has(name) ? userAuthMap.get(name)! : undefined;
}

function getRefreshSubscribers(name: string | undefined): ((token: string) => void)[] {
  const state = getAuthState(name);
  return state ? state.refreshSubscribers : globalRefreshSubscribers;
}

function clearRefreshSubscribers(name: string | undefined) {
  const state = getAuthState(name);
  if (state) {
    state.refreshSubscribers = [];
  } else {
    globalRefreshSubscribers = [];
  }
}

function onTokenRefreshed(name: string | undefined, newToken: string) {
  const subscribers = getRefreshSubscribers(name);
  subscribers.forEach(callback => callback(newToken));
  clearRefreshSubscribers(name);
}

function addRefreshSubscriber(name: string | undefined, callback: (token: string) => void) {
  const state = getAuthState(name);
  if (state) {
    state.refreshSubscribers.push(callback);
  } else {
    globalRefreshSubscribers.push(callback);
  }
}

export async function renewJwt(name?: string): Promise<string> {
  const logName = name || "Global";
  console.log(`[Auth] JWT expired or missing for ${logName}. Acquiring new guest session...`);

  // Adjust the payload/headers if your /start endpoint requires the X-Api-Token
  const response = await axios.post(config.JWT_URL);
  const newJwt = response.data.token;

  if (name && userAuthMap.has(name)) {
    userAuthMap.get(name)!.jwt = newJwt;
  }

  // Populate default global state if this is the first user or a global request
  if (!name || userAuthMap.size === 1) {
    authState.jwt = newJwt;
  }

  return newJwt;
}

export const apiClient = axios.create({
  baseURL: `${config.API_BASE_URL}`,
});

function injectAuthHeaders(config: any): any {
  const name = (config as any).userName as string | undefined;
  const state = getAuthState(name);

  const jwt = state?.jwt || authState.jwt;
  const apiToken = state?.apiToken || authState.apiToken;

  if (jwt) {
    config.headers['Authorization'] = `Bearer ${jwt}`;
  }
  if (apiToken) {
    config.headers['X-Api-Token'] = apiToken;
  }
  return config;
}

// Request interceptor: Always inject the latest tokens
apiClient.interceptors.request.use(injectAuthHeaders);

function setRefreshingState(name: string | undefined, isRefreshing: boolean) {
  const state = getAuthState(name);
  if (state) {
    state.isRefreshing = isRefreshing;
  } else {
    globalIsRefreshing = isRefreshing;
  }
}

function isRefreshingInProgress(name: string | undefined): boolean {
  const state = getAuthState(name);
  return state ? state.isRefreshing : globalIsRefreshing;
}

function invalidateCachedTokenIfApplicable(name: string | undefined) {
  const hadCachedToken = name && usersWithCachedToken.has(name);
  const keypairPath = name ? userKeypairMap.get(name) : undefined;
  if (hadCachedToken && keypairPath) {
    tokenCache.invalidateTokenCache(keypairPath);
    usersWithCachedToken.delete(name);
  }
}

async function handleTokenRefresh(name: string | undefined, originalRequest: any): Promise<any> {
  setRefreshingState(name, true);

  try {
    invalidateCachedTokenIfApplicable(name);
    const newToken = await renewJwt(name);
    setRefreshingState(name, false);
    onTokenRefreshed(name, newToken);
    return apiClient(originalRequest);
  } catch (refreshError) {
    setRefreshingState(name, false);
    console.error(`[Auth] Fatal: Could not renew JWT for ${name || "Global"}. Verify API Token.`, refreshError);
    return Promise.reject(refreshError);
  }
}

function retryWithRefreshedToken(name: string | undefined, originalRequest: any): Promise<any> {
  return new Promise(resolve => {
    addRefreshSubscriber(name, (newToken) => {
      originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
      resolve(apiClient(originalRequest));
    });
  });
}

// Response interceptor: Catch 401s and retry
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const name = (originalRequest as any).userName as string | undefined;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!isRefreshingInProgress(name)) {
        return handleTokenRefresh(name, originalRequest);
      } else {
        return retryWithRefreshedToken(name, originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

function loadUserKeypair(name: string, keypairLocation: string): Keypair {
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.error(`[${name}] Could not load user keypair at ${keypairLocation}`);
    throw err;
  }
}

function initializeUserAuthState(name: string, keypairLocation: string, existingJwt?: string, existingApiToken?: string): UserAuthState {
  let userState = userAuthMap.get(name);
  if (userState) return userState;

  const cachedApiToken = !existingApiToken ? tokenCache.getTokenFromCache(keypairLocation) : null;
  const usingCachedToken = !existingApiToken && !!cachedApiToken;

  userState = {
    apiToken: existingApiToken || cachedApiToken || '',
    jwt: existingJwt || '',
    isRefreshing: false,
    refreshSubscribers: []
  };
  userAuthMap.set(name, userState);

  if (usingCachedToken) {
    usersWithCachedToken.add(name);
  }

  return userState;
}

async function discoverPricingMatrix(name: string, program: any, pricingMatrixPda: PublicKey): Promise<void> {
  try {
    const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
    console.log(`Pricing matrix by authority: ${matrix.admin.toBase58()}`);
    console.log(`Service level id.   Tokens/week   Sampling (sec)  League bundle  Market bundle`);
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
  } catch (err) {
    console.log(`[${name}] Pricing matrix not available on this network (expected on devnet without on-chain state)`);
  }
}

async function ensureUserHasJwt(name: string, userState: UserAuthState): Promise<void> {
  if (!userState.jwt) {
    console.log(`[${name}] No existing JWT. Acquiring new guest session...`);
    const response = await axios.post(config.JWT_URL);
    userState.jwt = response.data.token;
  } else {
    console.log(`[${name}] Using provided JWT.`);
  }
}

function updateGlobalAuthStateIfFirstUser(userState: UserAuthState): void {
  if (userAuthMap.size === 1) {
    authState.jwt = userState.jwt;
    authState.apiToken = userState.apiToken;
  }
}

async function fetchUserTokenAccount(connection: Connection, userTokenAccountAddress: PublicKey): Promise<Account | undefined> {
  try {
    return await getAccount(connection, userTokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
  } catch (e) {
    return undefined;
  }
}

async function skipSubscriptionFlowWithExistingToken(name: string, user: Keypair, userTokenAccountAddress: PublicKey, connection: Connection): Promise<User> {
  console.log(`[${name}] Existing API Token detected. Bypassing on-chain payment and backend activation.`);
  const userTokenAccount = await fetchUserTokenAccount(connection, userTokenAccountAddress);
  if (!userTokenAccount) {
    console.log(`[${name}] Note: Could not fetch Token-2022 account on-chain. Assuming it exists.`);
  }
  return { user, userTokenAccount };
}

async function createTokenAccount(name: string, user: Keypair, connection: Connection, tokenMint: PublicKey, userTokenAccountAddress: PublicKey): Promise<void> {
  console.log(`[${name}] Creating User Token-2022 Account`);
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: user.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userTokenAccountAddress,
        user.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([user]);
  const txSignature = await connection.sendTransaction(tx);
  await connection.confirmTransaction(txSignature, "confirmed");
  console.log(`[${name}] Account created`);
}

async function waitForTokenAccountSync(name: string, connection: Connection, userTokenAccountAddress: PublicKey): Promise<Account> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let attempts = 0;
  while (attempts < 5) {
    try {
      return await getAccount(connection, userTokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
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
  throw new Error(`[${name}] RPC failed to sync the new token account.`);
}

async function ensureTokenAccountExists(name: string, user: Keypair, connection: Connection, tokenMint: PublicKey, userTokenAccountAddress: PublicKey): Promise<Account> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);

  if (!accountInfo) {
    await createTokenAccount(name, user, connection, tokenMint, userTokenAccountAddress);
    await delay(3000);
  }

  return waitForTokenAccountSync(name, connection, userTokenAccountAddress);
}

function validateSubscriptionDuration(weeks: number): void {
  if (weeks < 4 || weeks % 4 !== 0) {
    throw new Error(`Invalid subscription duration: ${weeks} weeks. Must be a multiple of 4.`);
  }
}

async function submitSubscriptionTransaction(
  name: string,
  user: Keypair,
  connection: Connection,
  program: any,
  pricingMatrixPda: PublicKey,
  tokenMint: PublicKey,
  userTokenAccount: Account,
  tokenTreasuryVault: PublicKey,
  tokenTreasuryPda: PublicKey,
  serviceLevelId: number,
  weeks: number
): Promise<string> {
  console.log(`[${name}] Subscribing on-chain: Level ${serviceLevelId}, Duration ${weeks} weeks`);

  const subscribeInstruction = buildInstruction(
    "subscribe",
    { serviceLevelId, weeks },
    {
      user: user.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault: tokenTreasuryVault,
      tokenTreasuryPda: tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
    program.programId
  );

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const messageV0 = new TransactionMessage({
    payerKey: user.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [subscribeInstruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([user]);

  const txSig = await connection.sendTransaction(tx);
  await connection.confirmTransaction({
    signature: txSig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, 'confirmed');

  console.log(`[${name}] Transaction confirmed: ${txSig}`);
  return txSig;
}

async function activateAndPersistToken(name: string, user: Keypair, userState: UserAuthState, txSig: string, selectedLeagues: number[], keypairLocation: string): Promise<void> {
  console.log(`[${name}] Acquiring API Token via activation endpoint...`);

  const messageString = `${txSig}:${selectedLeagues.join(",")}:${userState.jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, user.secretKey);
  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");

  const activationUrl = `${config.API_BASE_URL}/token/activate`;
  const activationResponse = await axios.post(
    activationUrl,
    { txSig: txSig, walletSignature: signatureBase64, leagues: selectedLeagues },
    { headers: { Authorization: `Bearer ${userState.jwt}` } }
  );

  userState.apiToken = activationResponse.data.token || activationResponse.data;
  tokenCache.saveTokenToCache(keypairLocation, userState.apiToken);

  if (userAuthMap.size === 1) {
    authState.apiToken = userState.apiToken;
  }
}

/**
 * Set up a user with tokens and perform a subscription use case.
 * Optional existingJwt and existingApiToken could be used to bypass acquisition.
 */
export async function setupUser(
  name: string,
  keypairLocation: string,
  tokenMint: PublicKey,
  connection: Connection,
  program: any,
  serviceLevelId: number,
  weeks: number,
  selectedLeagues: number[],
  existingJwt?: string,
  existingApiToken?: string
): Promise<User> {
  const user = loadUserKeypair(name, keypairLocation);
  userKeypairMap.set(name, keypairLocation);
  const userState = initializeUserAuthState(name, keypairLocation, existingJwt, existingApiToken);

  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);
  await discoverPricingMatrix(name, program, pricingMatrixPda);

  await ensureUserHasJwt(name, userState);
  updateGlobalAuthStateIfFirstUser(userState);

  if (userState.apiToken) {
    return await skipSubscriptionFlowWithExistingToken(name, user, userTokenAccountAddress, connection);
  }

  const userTokenAccount = await ensureTokenAccountExists(name, user, connection, tokenMint, userTokenAccountAddress);

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], program.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(tokenMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID);

  validateSubscriptionDuration(weeks);
  const txSig = await submitSubscriptionTransaction(name, user, connection, program, pricingMatrixPda, tokenMint, userTokenAccount, tokenTreasuryVault, tokenTreasuryPda, serviceLevelId, weeks);
  await activateAndPersistToken(name, user, userState, txSig, selectedLeagues, keypairLocation);

  return {
    user: user,
    userTokenAccount: userTokenAccount
  };
}

function verifyFeePayer(message: any, expectedBuyer: PublicKey): void {
  const feePayer = message.staticAccountKeys[0];
  if (!feePayer || !feePayer.equals(expectedBuyer)) {
    throw new Error("Safety check failed: Fee payer is not the expected buyer wallet");
  }
}

function verifyAdminSignature(transaction: VersionedTransaction, expectedBuyer: PublicKey): void {
  const message = transaction.message;
  const signatures = transaction.signatures;
  const hasAdminSignature = signatures.some((sig: Uint8Array | null, idx: number) => {
    if (!sig || sig.length === 0) return false;
    const sigPubkey = message.staticAccountKeys[idx];
    return sigPubkey && !sigPubkey.equals(expectedBuyer);
  });
  if (!hasAdminSignature) {
    throw new Error("Safety check failed: Missing backend admin signature");
  }
}

function getAllowedPrograms(programId: PublicKey): string[] {
  return [
    programId.toBase58(),
    "ComputeBudget111111111111111111111111111111",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
  ];
}

function verifyProgramAuthorization(programId: string, allowedPrograms: string[]): void {
  if (!allowedPrograms.includes(programId)) {
    throw new Error(`Safety check failed: Unauthorized program invocation detected ${programId}`);
  }
}

function verifyBuyerSignerAuthorization(instruction: any, message: any, expectedBuyer: PublicKey, programId: string): void {
  instruction.accountKeyIndexes.forEach((keyIdx: number) => {
    if (keyIdx < message.header.numRequiredSignatures) {
      const keyPubkey = message.staticAccountKeys[keyIdx];
      if (keyPubkey.equals(expectedBuyer)) {
        const isAuthorizedSigner = programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        if (!isAuthorizedSigner) {
          throw new Error(`Safety check failed: Buyer wallet requested as signer for unauthorized program ${programId}`);
        }
      }
    }
  });
}

function verifyOracleInstruction(instruction: any, programId: string, expectedAmount: BN, authorizedOracleId: string): void {
  if (programId !== authorizedOracleId) return;

  const decodedIx = decodeInstruction(instruction.data, programId);
  if (!decodedIx) {
    throw new Error("Safety check failed: Could not decode instruction data");
  }

  if ("purchaseSubscriptionTokenUsdt" !== convertSnakeToCamel(decodedIx.name)) {
    throw new Error(`Safety check failed: Server attempted to execute unauthorized function: ${decodedIx.name}`);
  }

  const args = parseInstructionArgs(decodedIx.name, decodedIx.data);
  const payloadAmount = args?.txlineAmount as BN | undefined;

  if (!payloadAmount || !payloadAmount.eq(expectedAmount)) {
    throw new Error(
      `Safety check failed: Amount mismatch! Bot requested ${expectedAmount.toString()}, but server payload contains ${payloadAmount?.toString() || "unknown"}`
    );
  }
}

function verifyOracleInstructionCount(count: number): void {
  if (count === 0) {
    throw new Error("Safety check failed: No Oracle instruction found in payload");
  }
  if (count > 1) {
    throw new Error("Safety check failed: Multiple Oracle instructions detected in payload");
  }
}

// Verify a decoded transaction to ensure it is safe to sign
export function verifyTransactionSafety(
  transaction: VersionedTransaction,
  expectedBuyer: PublicKey,
  program: any,
  expectedAmount: BN
): void {
  const message = transaction.message;

  verifyFeePayer(message, expectedBuyer);
  verifyAdminSignature(transaction, expectedBuyer);

  const allowedPrograms = getAllowedPrograms(program.programId);
  const authorizedOracleId = program.programId.toBase58();
  let oracleInstructionCount = 0;

  message.compiledInstructions.forEach((instruction: any) => {
    const programIdIdx = instruction.programIdIndex;
    const programId = message.staticAccountKeys[programIdIdx].toBase58();

    verifyProgramAuthorization(programId, allowedPrograms);
    verifyBuyerSignerAuthorization(instruction, message, expectedBuyer, programId);
    verifyOracleInstruction(instruction, programId, expectedAmount, authorizedOracleId);

    if (programId === authorizedOracleId) {
      oracleInstructionCount++;
    }
  });

  verifyOracleInstructionCount(oracleInstructionCount);
}