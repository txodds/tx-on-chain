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

function onTokenRefreshed(name: string | undefined, newToken: string) {
  if (name && userAuthMap.has(name)) {
    const state = userAuthMap.get(name)!;
    state.refreshSubscribers.forEach(callback => callback(newToken));
    state.refreshSubscribers = [];
  } else {
    globalRefreshSubscribers.forEach(callback => callback(newToken));
    globalRefreshSubscribers = [];
  }
}

function addRefreshSubscriber(name: string | undefined, callback: (token: string) => void) {
  if (name && userAuthMap.has(name)) {
    userAuthMap.get(name)!.refreshSubscribers.push(callback);
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

// Request interceptor: Always inject the latest tokens
apiClient.interceptors.request.use(config => {
  const name = (config as any).userName as string | undefined;
  const state = name ? userAuthMap.get(name) : undefined;

  const jwt = state?.jwt || authState.jwt;
  const apiToken = state?.apiToken || authState.apiToken;

  if (jwt) {
    config.headers['Authorization'] = `Bearer ${jwt}`;
  }
  if (apiToken) {
    config.headers['X-Api-Token'] = apiToken;
  }
  return config;
});

// Response interceptor: Catch 401s and retry
apiClient.interceptors.response.use(
  (response) => response, // Pass through successful responses immediately
  async (error) => {
    const originalRequest = error.config;
    const name = (originalRequest as any).userName as string | undefined;
    const state = name ? userAuthMap.get(name) : undefined;

    // Check if the specific user or global is currently refreshing
    const isCurrentlyRefreshing = state ? state.isRefreshing : globalIsRefreshing;

    // If we receive a 401 and have not already retried this specific request
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!isCurrentlyRefreshing) {
        if (state) state.isRefreshing = true;
        else globalIsRefreshing = true;

        try {
          // Fetch the new token
          const newToken = await renewJwt(name);
          
          if (state) state.isRefreshing = false;
          else globalIsRefreshing = false;
          
          onTokenRefreshed(name, newToken);
          
          // Retry the original request immediately
          return apiClient(originalRequest);
        } catch (refreshError) {
          if (state) state.isRefreshing = false;
          else globalIsRefreshing = false;
          
          console.error(`[Auth] Fatal: Could not renew JWT for ${name || "Global"}. Verify API Token.`, refreshError);
          return Promise.reject(refreshError);
        }
      } else {
        // If another request is already fetching the token, wait in line, then retry
        return new Promise(resolve => {
          addRefreshSubscriber(name, (newToken) => {
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }
    }

    // Reject any other errors normally
    return Promise.reject(error);
  }
);

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
      apiToken: existingApiToken || '',
      jwt: existingJwt || '',
      isRefreshing: false,
      refreshSubscribers: []
    };
    userAuthMap.set(name, userState);
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
    const response = await axios.post(config.JWT_URL);
    userState.jwt = response.data.token;
  } else {
    console.log(`[${name}] Using provided JWT.`);
  }

  // Populate default global state if this is the first user
  if (userAuthMap.size === 1) {
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

  // Update global fallback if this is the first user
  if (userAuthMap.size === 1) {
    authState.apiToken = userState.apiToken;
  }

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