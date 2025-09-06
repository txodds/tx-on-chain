import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import { AUTHORITY_PK, BASE_URL, KEYPAIR_PATH, RPC_ENDPOINT, TxOracleIDL } from "../../config";

const TEST_FIXTURE_ID = 16583861;

async function main() {
  console.log("Starting scores snapshot example");

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
    `Getting current scores snapshot for fixture ${TEST_FIXTURE_ID}...`
  );
  const currentScoresResponse = await httpClient.get(
    `/api/scores/snapshot/${TEST_FIXTURE_ID}`
  );
  const currentScores = currentScoresResponse.data;

  console.log(`Found ${currentScores.length} current scores entries`);
  if (currentScores.length > 0) {
    console.log("Sample current scores entry:", {
      id: currentScores[0].Id,
      fixtureId: currentScores[0].FixtureId,
      gameState: currentScores[0].GameState,
      action: currentScores[0].Action,
      timestamp: new Date(currentScores[0].Ts).toISOString(),
      sequence: currentScores[0].Seq,
      participant1Id: currentScores[0].Participant1Id,
      participant2Id: currentScores[0].Participant2Id,
      participant1IsHome: currentScores[0].Participant1IsHome,
    });

    if (currentScores[0].Score) {
      console.log("Score data keys:", Object.keys(currentScores[0].Score));
    }

    if (currentScores[0].Stats) {
      console.log(
        `Stats available: ${
          Object.keys(currentScores[0].Stats).length
        } different stats`
      );
      console.log(
        "Sample stats keys:",
        Object.keys(currentScores[0].Stats).slice(0, 5)
      );
    }

    const gameStateCounts = currentScores.reduce((acc: any, score: any) => {
      acc[score.GameState] = (acc[score.GameState] || 0) + 1;
      return acc;
    }, {});

    console.log("Game state distribution:");
    Object.entries(gameStateCounts).forEach(([state, count]) => {
      console.log(`  ${state}: ${count} entries`);
    });
  }

  const historicalTimestamp = Date.now() - 24 * 60 * 60 * 1000;
  console.log(
    `Getting historical scores snapshot for fixture ${TEST_FIXTURE_ID} as of ${new Date(
      historicalTimestamp
    ).toISOString()}...`
  );

  try {
    const historicalScoresResponse = await httpClient.get(
      `/api/scores/snapshot/${TEST_FIXTURE_ID}`,
      {
        params: { asOf: historicalTimestamp },
      }
    );
    const historicalScores = historicalScoresResponse.data;

    console.log(`Found ${historicalScores.length} historical scores entries`);
    if (historicalScores.length > 0) {
      console.log("Sample historical scores entry:", {
        id: historicalScores[0].Id,
        gameState: historicalScores[0].GameState,
        action: historicalScores[0].Action,
        timestamp: new Date(historicalScores[0].Ts).toISOString(),
        sequence: historicalScores[0].Seq,
      });
    }
  } catch (error) {
    console.log(`No historical scores available for the specified timestamp`);
  }

  console.log(`Getting live scores updates for fixture ${TEST_FIXTURE_ID}...`);
  try {
    const liveScoresResponse = await httpClient.get(
      `/api/scores/updates/${TEST_FIXTURE_ID}`
    );
    const liveScores = liveScoresResponse.data;

    console.log(`Found ${liveScores.length} live scores updates`);
    if (liveScores.length > 0) {
      console.log("Latest scores update:", {
        timestamp: new Date(liveScores[0].Ts).toISOString(),
        gameState: liveScores[0].GameState,
        action: liveScores[0].Action,
        sequence: liveScores[0].Seq,
        hasScore: !!liveScores[0].Score,
        hasStats: !!liveScores[0].Stats,
      });
    }
  } catch (error) {
    console.log(
      `No live scores updates available for fixture ${TEST_FIXTURE_ID}`
    );
  }

  console.log("Getting historical scores updates...");
  try {
    const epochDay = 20330;
    const hourOfDay = 19;
    const interval = 1;

    const historicalUpdatesResponse = await httpClient.get(
      `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`
    );
    const historicalUpdates = historicalUpdatesResponse.data;

    console.log(
      `Found ${historicalUpdates.length} historical scores updates for epoch day ${epochDay}, hour ${hourOfDay}`
    );
    if (historicalUpdates.length > 0) {
      console.log("Sample historical update:", {
        fixtureId: historicalUpdates[0].FixtureId,
        timestamp: new Date(historicalUpdates[0].Ts).toISOString(),
        gameState: historicalUpdates[0].GameState,
        action: historicalUpdates[0].Action,
        sequence: historicalUpdates[0].Seq,
      });
    }
  } catch (error) {
    console.log(
      "No historical scores updates available for the specified parameters"
    );
  }
}

if (require.main === module) {
  main().catch(console.error);
}
