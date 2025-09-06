import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import { AUTHORITY_PK, BASE_URL, KEYPAIR_PATH, RPC_ENDPOINT, TxOracleIDL } from "../../config";

const TEST_FIXTURE_ID = 16583861;
const TEST_SEQUENCE = 570;
const TEST_STAT_KEY = "2";

async function main() {
  console.log("Starting scores on-chain validation example");

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
    [Buffer.from("stake"), userKeypair.publicKey.toBuffer()],
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
      oracleState: PublicKey.findProgramAddressSync(
        [Buffer.from("oracle_state")],
        program.programId
      )[0],
      recipient: AUTHORITY_PK,
      stakeAccount: stakeAccountPda,
      stakeVault: PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), userKeypair.publicKey.toBuffer()],
        program.programId
      )[0],
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

  console.log(
    `Getting scores stat validation for fixture ${TEST_FIXTURE_ID}...`
  );
  const validationResponse = await httpClient.get(
    "/api/scores/stat-validation",
    {
      params: {
        fixtureId: TEST_FIXTURE_ID,
        seq: TEST_SEQUENCE,
        statKey: TEST_STAT_KEY,
      },
    }
  );
  const validation = validationResponse.data;

  console.log("Scores stat validation data received");

  const epochDay = Math.floor(validation.ts / (24 * 60 * 60 * 1000));

  const [dailyScoresRootsPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("daily_scores_roots"),
      new BN(epochDay).toArrayLike(Buffer, "le", 2),
    ],
    program.programId
  );

  const scoresRootsAccountInfo = await connection.getAccountInfo(
    dailyScoresRootsPda
  );
  if (!scoresRootsAccountInfo) {
    throw new Error(
      `Daily scores roots account not found for epoch day ${epochDay}`
    );
  }

  console.log(
    `Found daily scores roots account at ${dailyScoresRootsPda.toBase58()}`
  );

  const convertToUnsignedBytes = (hash: number[]): number[] => {
    if (!hash) return [];
    return hash.map((byte) => (byte < 0 ? byte + 256 : byte));
  };

  const statToProve = {
    key: validation.statToProve.key,
    value: validation.statToProve.value,
  };

  const predicate = {
    threshold: 2,
    comparison: { greaterThan: {} },
  };

  const statProof = validation.statProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  const fixtureProof = validation.subTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: convertToUnsignedBytes(
      validation.summary.eventStatsSubTreeRoot
    ),
  };

  console.log("Executing on-chain scores stat validation...");
  const signature = await program.methods
    .validateScoreStatWithPredicate(
      new BN(validation.ts),
      statToProve,
      predicate,
      statProof,
      convertToUnsignedBytes(validation.eventStatRoot),
      fixtureSummary,
      fixtureProof,
      mainTreeProof
    )
    .accounts({
      dailyScoresMerkleRoots: dailyScoresRootsPda,
    })
    .signers([userKeypair])
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000000,
      }),
    ])
    .rpc();

  console.log(`Transaction signature: ${signature}`);
  console.log(
    `Stat validated: ${statToProve.key} = ${statToProve.value} (threshold: ${predicate.threshold})`
  );
}

if (require.main === module) {
  main().catch(console.error);
}
