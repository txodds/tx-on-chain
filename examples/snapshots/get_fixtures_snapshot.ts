import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import {
  AUTHORITY_PK,
  BASE_URL,
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  TOKEN_MINT,
  TxOracleIDL,
} from "../../config";

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

  console.log(
    `Found ${fixtures.length} fixtures for NCAA Division I FBS from last saturday`
  );

  if (fixtures.length > 0) {
    console.log("Sample fixtures:");
    fixtures.slice(0, 3).forEach((fixture: any, index: number) => {
      console.log(
        `  ${index + 1}. ${fixture.Participant1} vs ${fixture.Participant2}`
      );
      console.log(
        `     ID: ${fixture.FixtureId}, Start: ${new Date(
          fixture.StartTime
        ).toISOString()}`
      );
      console.log(
        `     Home: ${
          fixture.Participant1IsHome
            ? fixture.Participant1
            : fixture.Participant2
        }`
      );
      console.log("     ---");
    });
  }

  console.log("\nGetting all competitions snapshot...");
  const allFixturesResponse = await httpClient.get("/api/fixtures/snapshot", {
    params: {
      startEpochDay: epochDay,
    },
  });
  const allFixtures = allFixturesResponse.data;

  console.log(
    `Found ${allFixtures.length} total fixtures for epoch day ${epochDay}`
  );

  if (allFixtures.length > 0) {
    const competitionCounts = allFixtures.reduce((acc: any, fixture: any) => {
      const competition = `${fixture.Competition} (ID: ${fixture.CompetitionId})`;
      acc[competition] = (acc[competition] || 0) + 1;
      return acc;
    }, {});

    console.log("Fixtures by competition (top 5):");
    Object.entries(competitionCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 5)
      .forEach(([competition, count]) => {
        console.log(`  ${competition}: ${count} fixtures`);
      });
  }
}

if (require.main === module) {
  main().catch(console.error);
}
