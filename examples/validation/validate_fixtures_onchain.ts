import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import {
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  BASE_URL,
  TxOracleIDL,
  AUTHORITY_PK,
} from "../../config";

async function main() {
  console.log("Starting fixture on-chain validation example");

  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");

  const PROGRAM_ID = new PublicKey(TxOracleIDL.address);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(userKeypair),
    { commitment: "confirmed" }
  );

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
    PROGRAM_ID
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
        PROGRAM_ID
      )[0],
      recipient: AUTHORITY_PK,
      stakeAccount: stakeAccountPda,
      stakeVault: PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), userKeypair.publicKey.toBuffer()],
        PROGRAM_ID
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

  console.log("Getting fixtures from last Saturday...");

  const today = new Date();
  const daysSinceSaturday = (today.getDay() + 1) % 7;
  const lastSaturday = new Date(today);
  lastSaturday.setDate(today.getDate() - daysSinceSaturday);
  const epochDay = Math.floor(lastSaturday.getTime() / (24 * 60 * 60 * 1000));

  console.log(
    `Last Saturday: ${lastSaturday.toDateString()} (epochDay: ${epochDay})`
  );

  const fixturesResponse = await httpClient.get("/api/fixtures/snapshot", {
    params: {
      competitionId: 500005,
      startEpochDay: epochDay,
    },
  });
  const fixtures = fixturesResponse.data;

  console.log(fixtures);

  if (!fixtures || fixtures.length === 0) {
    throw new Error("No fixtures found for the past hour");
  }

  const fixture = fixtures[0];

  console.log(`Getting fixture validation for fixture ${fixture.FixtureId}...`);
  const validationResponse = await httpClient.get("/api/fixtures/validation", {
    params: {
      fixtureId: fixture.FixtureId,
    },
  });
  const validation = validationResponse.data;

  console.log("Fixture validation data received");
  console.log(validation);

  const validationEpochDay = new BN(
    Math.floor(validation.snapshot.Ts / (24 * 60 * 60 * 1000))
  );
  const validationHourOfDay = new BN(
    Math.floor((validation.snapshot.Ts / (60 * 60 * 1000)) % 24)
  );

  const alignedEpochDay = Math.floor(validationEpochDay.toNumber() / 10) * 10;

  const [tenDailyFixturesRootsPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ten_daily_fixtures_roots"),
      new BN(alignedEpochDay).toArrayLike(Buffer, "le", 2),
    ],
    PROGRAM_ID
  );

  const merkleRootAccountInfo = await connection.getAccountInfo(
    tenDailyFixturesRootsPda
  );
  if (!merkleRootAccountInfo) {
    throw new Error(
      `Ten daily fixtures roots account not found for aligned epoch day ${alignedEpochDay}`
    );
  }

  console.log(
    `Found ten daily fixtures roots account at ${tenDailyFixturesRootsPda.toBase58()}`
  );

  const convertToUnsignedBytes = (hash: number[]): number[] => {
    if (!hash) return [];
    return hash.map((byte) => (byte < 0 ? byte + 256 : byte));
  };

  const snapshot = {
    ts: new BN(validation.snapshot.Ts),
    startTime: new BN(validation.snapshot.StartTime),
    competition: validation.snapshot.Competition,
    competitionId: new BN(validation.snapshot.CompetitionId),
    fixtureGroupId: new BN(validation.snapshot.FixtureGroupId),
    participant1Id: new BN(validation.snapshot.Participant1Id),
    participant1: validation.snapshot.Participant1,
    participant2Id: new BN(validation.snapshot.Participant2Id),
    participant2: validation.snapshot.Participant2,
    fixtureId: new BN(validation.snapshot.FixtureId),
    participant1IsHome: validation.snapshot.Participant1IsHome,
  };

  const summary = {
    fixtureId: new BN(validation.summary.fixtureId),
    competitionId: new BN(validation.summary.competitionId),
    competition: validation.summary.competition,
    updateStats: {
      updateCount: new BN(validation.summary.updateStats.updateCount),
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    updateSubTreeRoot: convertToUnsignedBytes(
      validation.summary.updateSubTreeRoot
    ),
  };

  const subTreeProof = validation.subTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  console.log("Executing on-chain fixture validation...");
  const signature = await program.methods
    .validateFixture(snapshot, summary, subTreeProof, mainTreeProof)
    .accounts({
      tenDailyFixturesRoots: tenDailyFixturesRootsPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000000,
      }),
    ])
    .signers([userKeypair])
    .rpc();

  console.log(`Transaction signature: ${signature}`);
}

if (require.main === module) {
  main().catch(console.error);
}
