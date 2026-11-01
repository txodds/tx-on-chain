import * as config from './config';
import * as fs from "fs";
import axios from "axios";
import nacl from "tweetnacl";
import { createHash } from "crypto";
import {
  Address,
  Rpc,
  SolanaRpcApi,
  KeyPairSigner,
  createKeyPairSignerFromBytes,
  address,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getStructEncoder,
  getU8Encoder,
  getU32Encoder,
  getU16Encoder,
  getU64Decoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage
} from "@solana/kit";

const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

export type User = {
  user: KeyPairSigner;
  userTokenAccount: Address | undefined;
}

export type UserAuthState = {
  apiToken: string;
  jwt: string;
  isRefreshing: boolean;
  refreshSubscribers: ((token: string) => void)[];
};

// Populate global fallback state by first user for backward compatibility
export const authState = {
  apiToken: '', 
  jwt: ''       
};

// Set global locks for requests that do not specify username
let globalIsRefreshing = false;
let globalRefreshSubscribers: ((token: string) => void)[] = [];

// Handle concurrent multi-user states
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
  
  // Adjust payload or headers if endpoint requires X-Api-Token
  const response = await axios.post(config.JWT_URL);
  const newJwt = response.data.token;

  if (name && userAuthMap.has(name)) {
    userAuthMap.get(name)!.jwt = newJwt;
  }
  
  // Populate default global state if this is first user or global request
  if (!name || userAuthMap.size === 1) {
    authState.jwt = newJwt;
  }

  return newJwt;
}

export const apiClient = axios.create({
  baseURL: `${config.API_BASE_URL}`,
});

// Timing interceptor for apiClient
apiClient.interceptors.request.use(config => {
  (config as any).metadata = { start: Date.now() };
  return config;
});
apiClient.interceptors.response.use(response => {
  const config: any = response.config;
  const start = config?.metadata?.start;
  if (start) {
    const dur = Date.now() - start;
    const hdr = response.headers['x-response-time'] || response.headers['server-timing'] || '';
    console.log(`[axios] ${config.method?.toUpperCase() || 'GET'} ${config.url} ${dur}ms status=${response.status} server=${hdr}`);
  }
  return response;
}, error => {
  const config: any = error.config;
  const start = config?.metadata?.start;
  if (start) {
    const dur = Date.now() - start;
    console.log(`[axios] ${config?.method?.toUpperCase() || 'GET'} ${config?.url} ${dur}ms error=${error.message}`);
  }
  return Promise.reject(error);
});

// Inject latest tokens via request interceptor
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

// Catch unauthorized errors and retry via response interceptor
apiClient.interceptors.response.use(
  (response) => response, 
  async (error) => {
    const originalRequest = error.config;
    const name = (originalRequest as any).userName as string | undefined;
    const state = name ? userAuthMap.get(name) : undefined;

    // Check if specific user or global is currently refreshing
    const isCurrentlyRefreshing = state ? state.isRefreshing : globalIsRefreshing;

    // Retry specific request if we receive an unauthorized error
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!isCurrentlyRefreshing) {
        if (state) state.isRefreshing = true;
        else globalIsRefreshing = true;

        try {
          // Fetch new token
          const newToken = await renewJwt(name);
          
          if (state) state.isRefreshing = false;
          else globalIsRefreshing = false;
          
          onTokenRefreshed(name, newToken);
          
          // Retry original request immediately
          return apiClient(originalRequest);
        } catch (refreshError) {
          if (state) state.isRefreshing = false;
          else globalIsRefreshing = false;
          
          console.error(`[Auth] Fatal: Could not renew JWT for ${name || "Global"}. Verify API Token.`, refreshError);
          return Promise.reject(refreshError);
        }
      } else {
        // Wait in line then retry if another request is fetching token
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

async function getAtaAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(TOKEN_2022_PROGRAM_ID),
      getAddressEncoder().encode(mint),
    ]
  });
  return ata;
}

/**
 * Set up a user with tokens and perform a subscription use case
 * Bypass acquisition using optional existingJwt and existingApiToken
 */
export async function setupUser(
  name: string,
  keypairLocation: string,
  tokenMint: Address,
  rpc: Rpc<SolanaRpcApi>,
  programId: Address,
  serviceLevelId: number,
  weeks: number,
  selectedLeagues: number[],
  existingJwt?: string,
  existingApiToken?: string 
): Promise<User> {
  let user: KeyPairSigner;
  let secretKey: Uint8Array;
  
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    user = await createKeyPairSignerFromBytes(secretKey);
  } catch (err) {
    console.error(`[${name}] Could not load user keypair at ${keypairLocation}`);
    throw err;
  }

  // Initialize user auth state
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

  const userTokenAccountAddress = await getAtaAddress(user.address, tokenMint);

  const [pricingMatrixPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [getUtf8Encoder().encode("pricing_matrix")]
  });
  
  // Note: Decode pricing matrix manually using codecs when not using Anchor
  async function discoverPricingMatrix() {
    const { value: matrixAccount } = await rpc.getAccountInfo(pricingMatrixPda, { encoding: 'base64' }).send();
    if (!matrixAccount) {
      console.log(`[${name}] Pricing matrix account not found on-chain`);
      return;
    }
    console.log(`[${name}] Pricing matrix fetched. Manual decoding required for console output`);
  }
  
  await discoverPricingMatrix();

  // Ensure JWT exists for backend requests
  if (!userState.jwt) {
    console.log(`[${name}] No existing JWT. Acquiring new guest session...`);
    const response = await axios.post(config.JWT_URL);
    userState.jwt = response.data.token;
  } else {
    console.log(`[${name}] Using provided JWT.`);
  }

  // Populate default global state if this is first user
  if (userAuthMap.size === 1) {
    authState.jwt = userState.jwt;
    authState.apiToken = userState.apiToken;
  }

  // Bypass on-chain and activation flows if API token exists
  if (userState.apiToken) {
    console.log(`[${name}] Existing API Token detected. Bypassing on-chain payment and backend activation.`);
    
    let userTokenAccount: Address | undefined;
    try {
      const { value: accountData } = await rpc.getAccountInfo(userTokenAccountAddress, { encoding: 'base64' }).send();
      if (accountData) userTokenAccount = userTokenAccountAddress;
    } catch (e) {
      console.log(`[${name}] Note: Could not fetch Token-2022 account on-chain`);
    }

    return {
      user: user,
      userTokenAccount: userTokenAccount
    };
  }

  // Execute standard subscription flow
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const { value: accountInfo } = await rpc.getAccountInfo(userTokenAccountAddress, { encoding: 'base64' }).send();
  
  if (!accountInfo) {
    console.log(`[${name}] Creating User Token-2022 Account`);
    
    const { value: ataBlockhash } = await rpc.getLatestBlockhash().send();

    const createAtaInstruction = {
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
      accounts: [
        { address: user.address, role: AccountRole.WRITABLE_SIGNER },
        { address: userTokenAccountAddress, role: AccountRole.WRITABLE },
        { address: user.address, role: AccountRole.READONLY },
        { address: tokenMint, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
        { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data: new Uint8Array(0),
    };

    const ataMessage = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(ataBlockhash, m),
      (m) => appendTransactionMessageInstruction(createAtaInstruction, m)
    );

    const signedAtaTx = await signTransactionMessageWithSigners(ataMessage);
    const wireAtaTx = getBase64EncodedWireTransaction(signedAtaTx);
    
    await rpc.sendTransaction(wireAtaTx, { encoding: "base64" }).send();
    console.log(`[${name}] Account created`);
    await delay(3000); 
  }

  let userTokenAccount: Address | undefined;
  let attempts = 0;
  while (attempts < 5) {
    const { value: checkInfo } = await rpc.getAccountInfo(userTokenAccountAddress, { encoding: 'base64' }).send();
    if (checkInfo) {
      userTokenAccount = userTokenAccountAddress;
      break; 
    }
    attempts++;
    console.log(`[${name}] RPC not synced. Retrying (${attempts}/5)...`);
    await delay(2000);
  }

  if (!userTokenAccount) {
    throw new Error(`[${name}] RPC failed to sync new token account`);
  }

  const [tokenTreasuryPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [getUtf8Encoder().encode("token_treasury_v2")]
  });
  
  const tokenTreasuryVault = await getAtaAddress(tokenTreasuryPda, tokenMint);

  if (weeks < 4 || weeks % 4 !== 0) {
    throw new Error(`Invalid subscription duration: ${weeks} weeks. Must be a multiple of 4`);
  }

  console.log(`[${name}] Subscribing on-chain: Level ${serviceLevelId}, Duration ${weeks} weeks`);

  const { value: subBlockhash } = await rpc.getLatestBlockhash().send();

  // Use exact instruction discriminator from IDL
  const subscribeDiscriminator = new Uint8Array([254, 28, 191, 138, 156, 179, 183, 53]);
  
  // Encode arguments exactly as defined in Rust program
  const argsEncoder = getStructEncoder([
    ['serviceLevelId', getU16Encoder()],
    ['weeks', getU8Encoder()]
  ]);
  
  const argsData = argsEncoder.encode({ serviceLevelId, weeks });
  const subscribeData = new Uint8Array(8 + argsData.length);
  subscribeData.set(subscribeDiscriminator, 0);
  subscribeData.set(argsData, 8);

  const subscribeInstruction = {
    programAddress: programId,
    accounts: [
      { address: user.address, role: AccountRole.WRITABLE_SIGNER },
      { address: pricingMatrixPda, role: AccountRole.READONLY },
      { address: tokenMint, role: AccountRole.READONLY },
      { address: userTokenAccount, role: AccountRole.WRITABLE },
      { address: tokenTreasuryVault, role: AccountRole.WRITABLE },
      { address: tokenTreasuryPda, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: subscribeData,
  };

  const subMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(user, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(subBlockhash, m),
    (m) => appendTransactionMessageInstruction(subscribeInstruction, m)
  );

  const signedSubTx = await signTransactionMessageWithSigners(subMessage);
  const wireSubTx = getBase64EncodedWireTransaction(signedSubTx);
  
  const txSig = await rpc.sendTransaction(wireSubTx, { encoding: "base64" }).send();

  console.log(`[${name}] Transaction confirmed: ${txSig}`);
  console.log(`[${name}] Acquiring API Token via activation endpoint...`);
  
  const messageString = `${txSig}:${selectedLeagues.join(",")}:${userState.jwt}`;
  const messageBytes = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(messageBytes, secretKey);
  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");

  const activationUrl = `${config.API_BASE_URL}/token/activate`;
  const activationResponse = await axios.post(
    activationUrl, 
    { txSig: txSig, walletSignature: signatureBase64, leagues: selectedLeagues }, 
    { headers: { Authorization: `Bearer ${userState.jwt}` } }
  );
  
  userState.apiToken = activationResponse.data.token || activationResponse.data;

  // Update global fallback if this is first user
  if (userAuthMap.size === 1) {
    authState.apiToken = userState.apiToken;
  }

  return {
    user: user,
    userTokenAccount: userTokenAccount
  };
}

// Verify decoded compiled wire transaction to ensure safety
export function verifyTransactionSafety(
  transaction: any,
  expectedBuyer: Address,
  programId: Address,
  expectedAmount: bigint
): void {
  // Decode raw binary message into compiled message object
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  
  // Decompile message back into high-level transaction message structure
  const message = decompileTransactionMessage(compiledMessage);

  // Extract fee payer directly from compiled account keys
  const feePayer = compiledMessage.staticAccounts[0];
  if (!feePayer || feePayer !== expectedBuyer) {
    throw new Error(`Safety check failed: Fee payer is not the expected buyer wallet (got ${feePayer}, expected ${expectedBuyer})`);
  }

  // Ensure backend admin has already signed transaction
  const hasAdminSignature = Object.keys(transaction.signatures || {}).some(
    signerAddress => signerAddress !== expectedBuyer
  );
  if (!hasAdminSignature) {
    throw new Error("Safety check failed: Missing backend admin signature");
  }

  // Whitelist permitted programs that transaction can invoke
  const allowedPrograms = [
    programId,
    "ComputeBudget111111111111111111111111111111",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
  ];

  let oracleInstructionCount = 0;

  // Inspect every instruction in decompiled payload
  message.instructions.forEach((instruction: any) => {
    const currentProgramId = instruction.programAddress;

    if (!allowedPrograms.includes(currentProgramId)) {
      throw new Error(`Safety check failed: Unauthorized program invocation detected ${currentProgramId}`);
    }

    // Verify buyer is not set as signer on unintended accounts
    instruction.accounts?.forEach((account: any) => {
      const isSigner = account.role === AccountRole.WRITABLE_SIGNER || account.role === AccountRole.READONLY_SIGNER;
      
      if (isSigner && account.address === expectedBuyer) {
        const isAuthorizedSigner = currentProgramId === programId || currentProgramId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        if (!isAuthorizedSigner) {
           throw new Error(`Safety check failed: Buyer wallet requested as signer for unauthorized program ${currentProgramId}`);
        }
      }
    });

    // Decode and verify specific oracle business logic
    if (currentProgramId === programId) {
      oracleInstructionCount++;

      if (!instruction.data) {
        throw new Error("Safety check failed: Could not decode instruction data");
      }

      // Check byte discriminator for function targeting
      const expectedDiscriminator = createHash("sha256").update("global:purchase_subscription_token_usdt").digest().subarray(0, 8);
      const actualDiscriminator = instruction.data.subarray(0, 8);

      for (let i = 0; i < 8; i++) {
        if (actualDiscriminator[i] !== expectedDiscriminator[i]) {
          throw new Error("Safety check failed: Server attempted to execute unauthorized function");
        }
      }

      // Extract and verify requested amount using kit decoder
      const amountData = instruction.data.subarray(8, 16);
      const payloadAmount = getU64Decoder().decode(amountData);

      if (payloadAmount !== expectedAmount) {
        throw new Error(`Safety check failed: Amount mismatch! Expected ${expectedAmount.toString()}, found ${payloadAmount.toString()}`);
      }
    }
  });

  if (oracleInstructionCount === 0) {
    throw new Error("Safety check failed: No Oracle instruction found in payload");
  }

  if (oracleInstructionCount > 1) {
    throw new Error("Safety check failed: Multiple Oracle instructions detected in payload");
  }
}