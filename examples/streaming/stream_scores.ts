import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import { AUTHORITY_PK, BASE_URL, KEYPAIR_PATH, RPC_ENDPOINT, TOKEN_MINT, TxOracleIDL } from "../../config";

async function main() {
  console.log("Starting scores streaming example");

  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(userKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(TxOracleIDL, provider);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: BASE_URL,
  });

  console.log("Authenticating...");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwtToken = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwtToken}`;

  const [stakeAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKeypair.publicKey.toBuffer(), TOKEN_MINT.toBuffer()],
    program.programId
  );
  const [stakeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), userKeypair.publicKey.toBuffer(), TOKEN_MINT.toBuffer()],
    program.programId
  );
  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  const stakeAccountInfo = await connection.getAccountInfo(stakeAccountPda);

  let apiToken: string = "";

  if (!stakeAccountInfo) {
    throw new Error(
      "No stake found. Please stake tokens first using the stake.ts example"
    );
  }

  console.log("Creating new subscription for existing stake...");

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

  const txSignature = await program.methods
    .subscribe(finalPayload)
    .accounts({
      user: userKeypair.publicKey,
      tokenMint: TOKEN_MINT,
      oracleState: oracleStatePda,
      recipient: AUTHORITY_PK,
      stakeAccount: stakeAccountPda,
      stakeVault: stakeVaultPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([userKeypair])
    .rpc();

  const activationUrl = `${BASE_URL}/api/token/activate?txsig=${txSignature}&key=${symmetricKey.toString(
    "base64url"
  )}&iv=${iv.toString("base64url")}`;

  const maxRetries = 3;
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

      console.log("API token received");
      break;
    } catch (error) {
      console.log(`Activation attempt ${attempt} failed`);

      if (attempt === maxRetries) {
        throw new Error("Failed to activate subscription after all attempts");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  console.log("Starting scores stream...");
  const streamUrl = `${BASE_URL}/api/scores/stream`;
  const streamResponse = await fetch(streamUrl, {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      "X-Api-Token": apiToken,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });

  if (!streamResponse.ok) {
    throw new Error(`Stream failed: ${streamResponse.status}`);
  }

  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();
  let eventCount = 0;
  const maxEvents = 5;

  console.log("Receiving scores updates...");
  try {
    while (eventCount < maxEvents) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.substring(6));
            eventCount++;
            console.log(`Scores Update ${eventCount}:`, {
              fixture: data.fixtureId,
              gameState: data.gameState,
              action: data.action,
              timestamp: new Date(data.ts).toISOString(),
              sequence: data.seq,
              participant1: data.participant1Id,
              participant2: data.participant2Id,
            });

            if (data.score) {
              console.log(
                `  Score data available with ${
                  Object.keys(data.score).length
                } stats`
              );
            }

            if (eventCount >= maxEvents) break;
          } catch (e) {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
