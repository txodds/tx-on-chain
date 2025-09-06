import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import { AUTHORITY_PK, BASE_URL, KEYPAIR_PATH, RPC_ENDPOINT, TxOracleIDL } from "../../config";

async function main() {
  console.log("Starting fixtures snapshot example");

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

  console.log("Getting all fixtures snapshot...");
  const allFixturesResponse = await httpClient.get("/api/fixtures/snapshot");
  const allFixtures = allFixturesResponse.data;

  console.log(`Found ${allFixtures.length} total fixtures`);
  if (allFixtures.length > 0) {
    console.log("Sample fixture:", {
      id: allFixtures[0].FixtureId,
      competition: allFixtures[0].Competition,
      competitionId: allFixtures[0].CompetitionId,
      participant1: allFixtures[0].Participant1,
      participant2: allFixtures[0].Participant2,
      startTime: new Date(allFixtures[0].StartTime).toISOString(),
      participant1IsHome: allFixtures[0].Participant1IsHome,
    });
  }

  const currentEpochDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  console.log(
    `Getting fixtures for epoch day ${currentEpochDay} and competition 1...`
  );

  const filteredFixturesResponse = await httpClient.get(
    "/api/fixtures/snapshot",
    {
      params: {
        startEpochDay: currentEpochDay,
        competitionId: 1,
      },
    }
  );
  const filteredFixtures = filteredFixturesResponse.data;

  console.log(
    `Found ${filteredFixtures.length} fixtures for competition 1 on epoch day ${currentEpochDay}`
  );

  const yesterdayEpochDay = currentEpochDay - 1;
  console.log(
    `Getting fixtures for yesterday (epoch day ${yesterdayEpochDay})...`
  );

  const yesterdayFixturesResponse = await httpClient.get(
    "/api/fixtures/snapshot",
    {
      params: {
        startEpochDay: yesterdayEpochDay,
      },
    }
  );
  const yesterdayFixtures = yesterdayFixturesResponse.data;

  console.log(`Found ${yesterdayFixtures.length} fixtures for yesterday`);
  if (yesterdayFixtures.length > 0) {
    const competitionCounts = yesterdayFixtures.reduce(
      (acc: any, fixture: any) => {
        acc[fixture.Competition] = (acc[fixture.Competition] || 0) + 1;
        return acc;
      },
      {}
    );
  }

  if (yesterdayFixtures.length > 0) {
    const testFixture = yesterdayFixtures[0];
    console.log(`Getting updates for fixture ${testFixture.FixtureId}...`);

    try {
      const updatesResponse = await httpClient.get(
        `/api/fixtures/updates/${yesterdayEpochDay}/${testFixture.FixtureId}`
      );
      const updates = updatesResponse.data;
      console.log(
        `Found ${updates.length} updates for fixture ${testFixture.FixtureId}`
      );

      if (updates.length > 0) {
        console.log("Latest update:", {
          timestamp: new Date(updates[0].Ts).toISOString(),
          startTime: new Date(updates[0].StartTime).toISOString(),
          participant1: updates[0].Participant1,
          participant2: updates[0].Participant2,
        });
      }
    } catch (error) {
      console.log(`No updates available for fixture ${testFixture.FixtureId}`);
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}
