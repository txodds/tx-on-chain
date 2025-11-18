import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  Account,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { EventSource } from "eventsource";
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
  BASE_URL,
  KEYPAIR_PATH,
  USER2_KEYPAIR_PATH,
  RPC_ENDPOINT,
  TxOracleIDL,
  TOKEN_MINT,
} from "../../config";
import { inspect } from "util";
import { SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Offer, OfferTerms } from "./types";
import { handleSubscription } from "../../utils/subscription";

const predicate = {
  threshold: 11,
  comparison: { greaterThan: {} },
};

async function main() {
  console.log("Starting trading example");

  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const user2Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(USER2_KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(userKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(TxOracleIDL, provider);

  console.log(`[Trader A] Using wallet: ${userKeypair.publicKey.toBase58()}`);
  console.log(`[Trader B] Using wallet: ${user2Keypair.publicKey.toBase58()}`);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: BASE_URL,
  });

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    TOKEN_MINT,
    userKeypair.publicKey
  );
  console.log(
    "[Trader A] User Token Account:",
    userTokenAccount.address.toBase58()
  );

  const user2TokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    user2Keypair,
    TOKEN_MINT,
    user2Keypair.publicKey
  );
  console.log(
    "[Trader B] User Token Account:",
    user2TokenAccount.address.toBase58()
  );

  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  console.log("[Trader A] Authenticating...");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwtToken = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwtToken}`;

  const symmetricKey = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", symmetricKey, iv);
  let encryptedPayload = cipher.update(jwtToken, "utf8", "hex");
  encryptedPayload += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  const finalPayload = Buffer.concat([
    Buffer.from(encryptedPayload, "hex"),
    authTag,
  ]);

  console.log("[Trader B] Authenticating...");
  const authResponse2 = await httpClient.post("/auth/guest/start");
  const jwtToken2 = authResponse2.data.token;

  const symmetricKey2 = randomBytes(32);
  const iv2 = randomBytes(16);
  const cipher2 = createCipheriv("aes-256-gcm", symmetricKey2, iv2);
  let encryptedPayload2 = cipher2.update(jwtToken2, "utf8", "hex");
  encryptedPayload2 += cipher2.final("hex");
  const authTag2 = cipher2.getAuthTag();
  const finalPayload2 = Buffer.concat([
    Buffer.from(encryptedPayload2, "hex"),
    authTag2,
  ]);

  const txSig = await handleSubscription(
    program,
    userKeypair,
    userTokenAccount,
    TOKEN_MINT,
    finalPayload,
    "Trader A"
  );

  const txSig2 = await handleSubscription(
    program,
    user2Keypair,
    user2TokenAccount,
    TOKEN_MINT,
    finalPayload2,
    "Trader B"
  );

  const activationUrl = `${BASE_URL}/api/token/activate?txsig=${txSig}&key=${symmetricKey.toString(
    "base64url"
  )}&iv=${iv.toString("base64url")}`;

  const maxRetries = 3;
  let apiToken: string = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const activationResponse = await axios.get(activationUrl, {
        headers: { Authorization: `Bearer ${jwtToken}` },
        timeout: 15000,
      });
      apiToken = activationResponse.data;

      if (!apiToken) {
        throw new Error("No API token received");
      }

      console.log("[Trader A] API token received");
      break;
    } catch (error) {
      console.log(`[Trader A] Activation attempt ${attempt} failed`);

      if (attempt === maxRetries) {
        throw new Error("Failed to activate subscription after all attempts");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const httpClientA = axios.create({
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtToken}`,
      "X-Api-Token": apiToken,
    },
    baseURL: BASE_URL,
  });

  const activationUrl2 = `${BASE_URL}/api/token/activate?txsig=${txSig2}&key=${symmetricKey2.toString(
    "base64url"
  )}&iv=${iv2.toString("base64url")}`;

  let apiToken2: string = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const activationResponse2 = await axios.get(activationUrl2, {
        headers: { Authorization: `Bearer ${jwtToken2}` },
        timeout: 15000,
      });
      apiToken2 = activationResponse2.data;

      if (!apiToken2) {
        throw new Error("No API token received");
      }

      console.log("[Trader B] API token received");
      break;
    } catch (error) {
      console.log(`[Trader B] Activation attempt ${attempt} failed`);

      if (attempt === maxRetries) {
        throw new Error("Failed to activate subscription after all attempts");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const httpClientB = axios.create({
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtToken2}`,
      "X-Api-Token": apiToken2,
    },
    baseURL: BASE_URL,
  });

  const depositAmount = new BN(60 * (10 ** 6));

  const [tradingVaultAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_vault"), userKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [tradingVaultTokensPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_tokens"), userKeypair.publicKey.toBuffer()],
    program.programId
  );

  const userTokenBalance = await connection.getTokenAccountBalance(userTokenAccount.address);
  console.log(`[Trader A] Current token balance: ${userTokenBalance.value.uiAmount}`);

  const tradingVaultAccountInfo = await connection.getAccountInfo(tradingVaultAccountPda);
  if (tradingVaultAccountInfo) {
    console.log(`[Trader A] Trading vault exists. Checking balance...`);
  } else {
    console.log("[Trader A] Depositing funds into on-chain Trading Vault...");
    try {
      const depositTx = await program.methods
        .deposit(depositAmount)
        .accounts({
          user: userKeypair.publicKey,
          oracleState: oracleStatePda,
          tradingVaultAccount: tradingVaultAccountPda,
          tradingVaultTokens: tradingVaultTokensPda,
          userTokenAccount: userTokenAccount.address,
          tokenMint: TOKEN_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .transaction();

      const depositSig = await provider.sendAndConfirm(depositTx, [userKeypair]);
      console.log(`[Trader A] Deposit successful. Transaction signature: ${depositSig}`);
    } catch (err: any) {
      if (err.message?.includes('insufficient funds')) {
        console.log(`[Trader A] Insufficient funds in token account. Skipping deposit.`);
      } else {
        throw err;
      }
    }
  }

  const depositAmount2 = new BN(60 * (10 ** 6));

  const [tradingVaultAccountPda2] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_vault"), user2Keypair.publicKey.toBuffer()],
    program.programId
  );
  const [tradingVaultTokensPda2] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_tokens"), user2Keypair.publicKey.toBuffer()],
    program.programId
  );

  const user2TokenBalance = await connection.getTokenAccountBalance(user2TokenAccount.address);
  console.log(`[Trader B] Current token balance: ${user2TokenBalance.value.uiAmount}`);

  const tradingVaultAccountInfo2 = await connection.getAccountInfo(tradingVaultAccountPda2);
  const wallet2 = new Wallet(user2Keypair);
  const provider2 = new AnchorProvider(connection, wallet2, {
    commitment: "confirmed",
  });

  if (tradingVaultAccountInfo2) {
    console.log(`[Trader B] Trading vault exists. Checking balance...`);
  } else {
    console.log("[Trader B] Depositing funds into on-chain Trading Vault...");
    try {
      const depositTx2 = await program.methods
        .deposit(depositAmount2)
        .accounts({
          user: user2Keypair.publicKey,
          oracleState: oracleStatePda,
          tradingVaultAccount: tradingVaultAccountPda2,
          tradingVaultTokens: tradingVaultTokensPda2,
          userTokenAccount: user2TokenAccount.address,
          tokenMint: TOKEN_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .transaction();

      const depositSig2 = await provider2.sendAndConfirm(depositTx2, [user2Keypair]);
      console.log(`[Trader B] Deposit successful. Transaction signature: ${depositSig2}`);
    } catch (err: any) {
      if (err.message?.includes('insufficient funds')) {
        console.log(`[Trader B] Insufficient funds in token account. Skipping deposit.`);
      } else {
        throw err;
      }
    }
  }

  listenToTradingStream(
    "Trader A",
    jwtToken,
    apiToken,
    userKeypair,
    program,
    userTokenAccount,
    httpClientA
  );

  listenToTradingStream(
    "Trader B",
    jwtToken2,
    apiToken2,
    user2Keypair,
    program,
    user2TokenAccount,
    httpClientB
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("[Trader A] Preparing to post a new order to the order book...");

  const offerTerms: OfferTerms = {
    fixtureId: new BN(17271370),
    period: 4,
    predicate,
    binaryOp: null,
    statA: { key: 1 },
    statB: null,
    stake: new BN(10 * (10 ** 6)),
    odds: 2000,
    expiration: new BN(Date.now() + 24 * 60 * 60 * 1000),
  };

  try {
    const result = await postNewOrder(
      offerTerms,
      userKeypair,
      jwtToken,
      apiToken,
      "Trader A"
    );
    console.log("[Trader A] Order submission result:", result);
  } catch (error) {
    console.error("[Trader A] Error posting order:", error);
  }

  console.log("Waiting for trading events and settlement...");
  await new Promise((resolve) => setTimeout(resolve, 62000));

  console.log("Trading example completed.");
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}

async function postNewOrder(
  terms: OfferTerms,
  user: Keypair,
  jwt: string,
  apiToken: string,
  userName: string
) {
  console.log(`[${userName}] Posting a new offer to the order book...`);

  const offer = new Offer({
    ...terms,
    traderPubkey: user.publicKey,
  });
  console.log(`[${userName}] Prepared offer:`, inspect(offer, { depth: null, colors: true }));

  const serializedOffer = offer.serialize();
  console.log(`[${userName}] Client-side offer bytes:`, serializedOffer.toString('hex'));

  const signature = nacl.sign.detached(serializedOffer, user.secretKey);
  console.log(`[${userName}] Offer cryptographically signed. Signature (bs58): ${bs58.encode(signature)}`);

  const payload = {
    offer: {
      ...offer,
      fixtureId: offer.fixtureId.toNumber(),
      stake: offer.stake.toNumber(),
      expiration: offer.expiration.toNumber(),
      traderPubkey: offer.traderPubkey.toBase58(),
    },
    signature: bs58.encode(signature),
  };

  const response = await axios.post(`${BASE_URL}/api/trading/offer`, payload, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'X-Api-Token': apiToken
    }
  });

  console.log(`[${userName}] Offer successfully submitted. Server response:`, response.data);
  return response.data;
}

async function listenToTradingStream(
  bot: string,
  jwt: string,
  apiToken: string,
  user: Keypair,
  program: Program,
  tokenAccount: Account,
  httpClient: any
) {
  console.log(`[${bot}] Subscribing to trading event stream...`);

  const streamUrl = `${BASE_URL}/api/trading/stream`;

  const eventSource = new EventSource(streamUrl, {
    fetch: (input: any, init: any) =>
      fetch(input, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${jwt}`,
          "X-Api-Token": apiToken,
        },
      }),
  });

  eventSource.onopen = () => {
    console.log(`[${bot}] Stream connection opened.`);
  };

  eventSource.onerror = (err: any) => {
    console.error(`[${bot}] Stream connection error: ${err}`);
  };

  eventSource.addEventListener("NewOffer", async (event: any) => {
    if (bot == "Trader B") {
      const data = JSON.parse(event.data);
      const prefix = `[${bot}] [EVENT] New Offer (ID: ${event.lastEventId}):`;
      const inspectedOffer = inspect(data.offer, {
        depth: null,
        colors: true,
      });
      console.log(prefix, inspectedOffer);

      const offerIdToAccept = data.offerId;

      const messageBuffer = new BN(offerIdToAccept).toBuffer("le", 4);

      const signature = nacl.sign.detached(messageBuffer, user.secretKey);

      const acceptancePayload = {
        offerId: offerIdToAccept,
        acceptingTraderPubkey: user.publicKey.toBase58(),
        signature: bs58.encode(signature),
      };

      const response = await httpClient.post(
        "/api/trading/accept",
        acceptancePayload
      );
      console.log(
        `[${bot}] Accept successfully acknowledged. Server response:`,
        response.data
      );
    }
  });

  eventSource.addEventListener("TradeMatched", async (event: any) => {
    const data = JSON.parse(event.data);
    const prefix = `[${bot}] [EVENT] Trade matched (ID: ${event.lastEventId}):`;
    const inspectedEvent = inspect(data, { depth: null, colors: true });
    console.log(prefix, inspectedEvent);
    if (bot == "Trader B") {
      console.log(`[${bot}] Attempting settlement`);
      const url = `${BASE_URL}/api/scores/stat-validation?fixtureId=17271370&seq=401&statKey=1`;
      const response = await httpClient.get(url);
      console.log("Response from off-chain stat-validation:", response.data);
      const validation = response.data;
      const tradeId = new BN(data.tradeId);

      const fixtureSummary = {
        fixtureId: new BN(validation.summary.fixtureId),
        updateStats: {
          updateCount: validation.summary.updateStats.updateCount,
          minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: validation.summary.eventStatsSubTreeRoot,
      };

      const fixtureProof = validation.subTreeProof.map((node: any) => ({
        hash: node.hash,
        isRightSibling: node.isRightSibling,
      }));

      const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
        hash: node.hash,
        isRightSibling: node.isRightSibling,
      }));

      const stat1 = {
        statToProve: validation.statToProve,
        eventStatRoot: validation.eventStatRoot,
        statProof: validation.statProof.map((node: any) => ({
          hash: node.hash,
          isRightSibling: node.isRightSibling,
        })),
      };

      const epochDay = Math.floor(validation.ts / (24 * 60 * 60 * 1000));
      const [dailyScoresPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("daily_scores_roots"), new BN(epochDay).toBuffer("le", 2)],
        program.programId
      );

      console.log(
        `[${bot}] Found daily batch roots account at ${dailyScoresPda.toBase58()}`
      );
      const [tradeEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), tradeId.toBuffer("le", 8)],
        program.programId
      );

      const [escrowVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow_vault"), tradeId.toBuffer("le", 8)],
        program.programId
      );

      console.log(`[${bot}] Executing a 1-stat settlement on-chain...`);

      const txSignature = await program.methods
        .settleTrade(
          tradeId,
          new BN(validation.ts),
          fixtureSummary,
          fixtureProof,
          mainTreeProof,
          predicate,
          stat1,
          null,
          null
        )
        .accounts({
          winner: user.publicKey,
          dailyScoresMerkleRoots: dailyScoresPda,
          tradeEscrow: tradeEscrowPda,
          escrowVault: escrowVaultPda,
          winnerTokenAccount: tokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 600_000,
          }),
        ])
        .signers([user])
        .rpc();

      console.log(
        `[${bot}] On-chain settlement successful with transaction signature: ${txSignature}`
      );
    }
  });

  eventSource.addEventListener("SigningRequest", async (event: any) => {
    try {
      const data = JSON.parse(event.data);
      console.log(
        `[${bot}] [EVENT] Received SigningRequest: ${data.recipientPubkey} ${data.partiallySignedTx}`
      );

      const messageToSign = Buffer.from(data.partiallySignedTx, "base64");

      const signature = nacl.sign.detached(messageToSign, user.secretKey);

      const signaturePayload = {
        tradeId: data.tradeId,
        signer: user.publicKey.toBase58(),
        signature: bs58.encode(signature),
      };

      await httpClient.post("/api/trading/sign", signaturePayload);
      console.log(
        `[${bot}] Signature for trade ${data.tradeId} sent successfully.`
      );
    } catch (err) {
      console.error(`[${bot}] Failed to process signing request: ${err}`);
    }
  });
}