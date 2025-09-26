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
import { BinaryWriter } from "borsh";
import { EventSource } from "eventsource";
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
  AUTHORITY_PK,
  BASE_URL,
  KEYPAIR_PATH,
  USER2_KEYPAIR_PATH,
  RPC_ENDPOINT,
  TxOracleIDL,
  TOKEN_MINT,
} from "../../config";
import { inspect } from "util";

const predicate = {
  threshold: 11,
  comparison: { greaterThan: {} },
};

class ComparisonEnum {
  type: string;

  constructor(properties: { [key: string]: {} }) {
    this.type = Object.keys(properties)[0];
  }

  serialize(writer: BinaryWriter): void {
    const discriminant =
      this.type === "greaterThan" ? 0 : this.type === "lessThan" ? 1 : 2;
    writer.writeU8(discriminant);
  }

  toJSON() {
    return {
      type: this.type.charAt(0).toUpperCase() + this.type.slice(1),
    };
  }
}

class BinaryOpEnum {
  type: string;

  constructor(properties: { [key: string]: {} }) {
    this.type = Object.keys(properties)[0];
  }

  serialize(writer: BinaryWriter): void {
    const discriminant = this.type === "add" ? 0 : 1;
    writer.writeU8(discriminant);
  }

  toJSON() {
    return {
      type: this.type.charAt(0).toUpperCase() + this.type.slice(1),
    };
  }
}

class StatTerm {
  key: number;
  constructor(fields: { key: number }) {
    this.key = fields.key;
  }

  serialize(writer: BinaryWriter): void {
    writer.writeU16(this.key);
  }
}

class Predicate {
  threshold: number;
  comparison: ComparisonEnum;

  constructor(fields: {
    threshold: number;
    comparison: { [key: string]: {} };
  }) {
    this.threshold = fields.threshold;
    this.comparison = new ComparisonEnum(fields.comparison);
  }
  serialize(writer: BinaryWriter): void {
    const thresholdBuffer = new BN(this.threshold).toBuffer("le", 4);
    writer.writeFixedArray(thresholdBuffer);

    this.comparison.serialize(writer);
  }
}

class Offer {
  fixtureId: BN;
  period: number;
  predicate: Predicate;
  binaryOp?: BinaryOpEnum;
  statA: StatTerm;
  statB?: StatTerm;
  stake: BN;
  odds: number;
  expiration: BN;
  traderPubkey: PublicKey;

  constructor(fields: any) {
    this.fixtureId = fields.fixtureId;
    this.period = fields.period;
    this.predicate = new Predicate(fields.predicate);
    this.binaryOp = fields.binaryOp
      ? new BinaryOpEnum(fields.binaryOp)
      : undefined;
    this.statA = new StatTerm(fields.statA);
    this.statB = fields.statB ? new StatTerm(fields.statB) : undefined;
    this.stake = fields.stake;
    this.odds = fields.odds;
    this.expiration = fields.expiration;
    this.traderPubkey = fields.traderPubkey;
  }

  serialize(): Buffer {
    const writer = new BinaryWriter();

    writer.writeU64(this.fixtureId);
    writer.writeU8(this.period);
    this.predicate.serialize(writer);

    writer.writeU8(this.binaryOp ? 1 : 0);
    if (this.binaryOp) {
      this.binaryOp.serialize(writer);
    }

    this.statA.serialize(writer);

    writer.writeU8(this.statB ? 1 : 0);
    if (this.statB) {
      this.statB.serialize(writer);
    }

    writer.writeU64(this.stake);

    writer.writeFixedArray(new BN(this.odds).toBuffer("le", 4));

    writer.writeFixedArray(this.expiration.toBuffer("le", 8));
    writer.writeFixedArray(this.traderPubkey.toBuffer());

    return Buffer.from(writer.toArray());
  }
}

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

  const tokenMint = TOKEN_MINT;

  console.log("Token Mint:", tokenMint.toBase58());

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: BASE_URL,
  });

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    tokenMint,
    userKeypair.publicKey
  );
  console.log(
    "[Trader A] User Token Account:",
    userTokenAccount.address.toBase58()
  );

  const user2TokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    user2Keypair,
    tokenMint,
    user2Keypair.publicKey
  );
  console.log(
    "[Trader B] User Token Account:",
    user2TokenAccount.address.toBase58()
  );

  const [stakeAccountPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("stake"),
      userKeypair.publicKey.toBuffer(),
      tokenMint.toBuffer(),
    ],
    program.programId
  );
  const [stakeVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      userKeypair.publicKey.toBuffer(),
      tokenMint.toBuffer(),
    ],
    program.programId
  );
  const [stakeAccountPda2] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("stake"),
      user2Keypair.publicKey.toBuffer(),
      tokenMint.toBuffer(),
    ],
    program.programId
  );
  const [stakeVaultPda2] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      user2Keypair.publicKey.toBuffer(),
      tokenMint.toBuffer(),
    ],
    program.programId
  );
  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );
  console.log("[Trader A] Stake Account PDA:", stakeAccountPda.toBase58());
  console.log("[Trader A] Stake Vault PDA:", stakeVaultPda.toBase58());
  console.log("[Trader B] Stake Account PDA:", stakeAccountPda2.toBase58());

  const stakeAccountInfo = await connection.getAccountInfo(stakeAccountPda);
  const stakeAccountInfo2 = await connection.getAccountInfo(stakeAccountPda2);

  if (!stakeAccountInfo) {
    throw new Error(
      "No stake found for Trader A. Please stake tokens first using the stake.ts example"
    );
  }

  if (!stakeAccountInfo2) {
    throw new Error(
      "No stake found for Trader B. Please stake tokens first using the stake.ts example"
    );
  }

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

  const txSig = await program.methods
    .subscribe(finalPayload)
    .accounts({
      user: userKeypair.publicKey,
      tokenMint: tokenMint,
      oracleState: oracleStatePda,
      recipient: AUTHORITY_PK,
      stakeAccount: stakeAccountPda,
      stakeVault: stakeVaultPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([userKeypair])
    .rpc();

  console.log("[Trader A] Subscription successful! Stake is locked.");
  console.log("[Trader A] Transaction Signature:", txSig);

  const txSig2 = await program.methods
    .subscribe(finalPayload2)
    .accounts({
      user: user2Keypair.publicKey,
      tokenMint: tokenMint,
      oracleState: oracleStatePda,
      recipient: AUTHORITY_PK,
      stakeAccount: stakeAccountPda2,
      stakeVault: stakeVaultPda2,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([user2Keypair])
    .rpc();

  console.log("[Trader B] Subscription successful! Stake is locked.");
  console.log("[Trader B] Transaction Signature:", txSig2);

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

  // Create authenticated httpClient for Trader A
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

  // Create authenticated httpClient for Trader B
  const httpClientB = axios.create({
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtToken2}`,
      "X-Api-Token": apiToken2,
    },
    baseURL: BASE_URL,
  });

  try {
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

    const offer = new Offer({
      fixtureId: new BN(17271370),
      period: 4,
      predicate,
      binaryOp: null,
      statA: { key: 1 },
      statB: null,
      stake: new BN(1),
      odds: 2000,
      expiration: new BN(Date.now() + 60 * 60 * 1000),
      traderPubkey: userKeypair.publicKey,
    });
    const prefix = `[Trader A] Submitting new offer:`;
    const inspectedOffer = inspect(offer, { depth: null, colors: true });
    console.log(prefix, inspectedOffer);

    const serializedOffer = offer.serialize();

    console.log(
      "[Trader A] Client-side offer bytes:",
      serializedOffer.toString("hex")
    );

    const signature = nacl.sign.detached(
      serializedOffer,
      userKeypair.secretKey
    );

    console.log(
      `[Trader A] Offer cryptographically signed. Signature (bs58): ${bs58.encode(
        signature
      )}`
    );

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

    const response = await httpClient.post("/api/trading/offer", payload, {
      headers: {
        "X-Api-Token": apiToken,
      },
    });
    console.log(
      "[Trader A] Offer successfully submitted. Server response:",
      response.data
    );
  } catch (error) {
    console.error("Error in trading flow:", error);
    throw error;
  }

  const waitDuration = 62 * 1000;
  console.log(
    `Waiting for ${waitDuration / 1000} seconds for trading to complete...`
  );
  await new Promise((resolve) => setTimeout(resolve, waitDuration));
}

if (require.main === module) {
  main().catch(console.error);
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
    const inspectedEvent = inspect(data.offer, { depth: null, colors: true });
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

      const predicate = {
        threshold: 11,
        comparison: { greaterThan: {} },
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
