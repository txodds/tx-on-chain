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
import {
  AUTHORITY_PK,
  BASE_URL,
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  TxOracleIDL,
} from "../../config";

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

  console.log(`Using fixture ${fixture.FixtureId}...`);

  console.log(`Getting scores snapshot for fixture ${fixture.FixtureId}...`);

  const scoresResponse = await httpClient.get(
    `/api/scores/snapshot/${fixture.FixtureId}`
  );
  const scoreUpdates = scoresResponse.data;

  console.log(`Found ${scoreUpdates.length} score updates`);

  if (!scoreUpdates || scoreUpdates.length === 0) {
    throw new Error("No score updates found for fixture");
  }

  const touchdownUpdate = scoreUpdates.find(
    (update: { Action: string }) => update.Action === "touchdown"
  );

  if (!touchdownUpdate) {
    throw new Error("No touchdown action found in score updates");
  }

  const scoreUpdate = touchdownUpdate;
  const statKey = 1;

  console.log(
    `Getting scores stat validation for fixture ${fixture.FixtureId}, seq ${scoreUpdate.Seq}, statKey ${statKey}...`
  );
  const validationResponse = await httpClient.get(
    "/api/scores/stat-validation",
    {
      params: {
        fixtureId: fixture.FixtureId,
        seq: scoreUpdate.Seq,
        statKey: statKey,
      },
    }
  );
  const validation = validationResponse.data;

  console.log("Scores stat validation data received");

  console.log(validation);

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

  const statToProve = {
    statToProve: {
      key: validation.statToProve.key,
      value: validation.statToProve.value,
      period: validation.statToProve.period,
    },
    eventStatRoot: validation.eventStatRoot,
    statProof: validation.statProof.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    })),
  };

  const predicate = {
    threshold: validation.statToProve.value,
    comparison: { equalTo: {} },
  };

  const fixtureProof = validation.subTreeProof.map((node: any) => ({
    hash: node.hash,
    isRightSibling: node.isRightSibling,
  }));

  const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
    hash: node.hash,
    isRightSibling: node.isRightSibling,
  }));

  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: validation.summary.eventStatsSubTreeRoot,
  };

  console.log("Executing on-chain stat validation with single stat...");
  const signature1 = await program.methods
    .validateStat(
      new BN(validation.ts),
      fixtureSummary,
      fixtureProof,
      mainTreeProof,
      predicate,
      statToProve,
      null,
      null
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

  console.log(`Single stat validation signature: ${signature1}`);
  console.log(
    `Single stat validated: ${statToProve.statToProve.key} = ${statToProve.statToProve.value} (threshold: ${predicate.threshold})`
  );

  const statB = {
    statToProve: {
      key: validation.statToProve.key,
      value: validation.statToProve.value,
      period: validation.statToProve.period,
    },
    eventStatRoot: validation.eventStatRoot,
    statProof: validation.statProof.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    })),
  };

  const binaryOp = { add: {} };

  console.log("Executing on-chain stat validation with both stats...");
  const signature2 = await program.methods
    .validateStat(
      new BN(validation.ts),
      fixtureSummary,
      fixtureProof,
      mainTreeProof,
      predicate,
      statToProve,
      statB,
      binaryOp
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

  console.log(`Both stats validation signature: ${signature2}`);
  console.log(
    `Both stats validated: ${statToProve.statToProve.key} = ${statToProve.statToProve.value}, ${statB.statToProve.key} = ${statB.statToProve.value} (threshold: ${predicate.threshold})`
  );
}

if (require.main === module) {
  main().catch(console.error);
}
