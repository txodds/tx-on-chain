import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import { AUTHORITY_PK, BASE_URL, KEYPAIR_PATH, RPC_ENDPOINT, TxOracleIDL } from "../../config";

const TEST_FIXTURE_ID = 17151124;

async function main() {
  console.log("Starting odds snapshot example");

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
    `Getting current odds snapshot for fixture ${TEST_FIXTURE_ID}...`
  );
  const currentOddsResponse = await httpClient.get(
    `/api/odds/snapshot/${TEST_FIXTURE_ID}`
  );
  const currentOdds = currentOddsResponse.data;

  console.log(`Found ${currentOdds.length} current odds entries`);
  if (currentOdds.length > 0) {
    console.log("Sample current odds entry:", {
      fixtureId: currentOdds[0].FixtureId,
      messageId: currentOdds[0].MessageId,
      bookmaker: currentOdds[0].Bookmaker,
      superOddsType: currentOdds[0].SuperOddsType,
      inRunning: currentOdds[0].InRunning,
      timestamp: new Date(currentOdds[0].Ts).toISOString(),
      priceNames: currentOdds[0].PriceNames?.slice(0, 3),
      prices: currentOdds[0].Prices?.slice(0, 3),
    });

    const bookmakerCounts = currentOdds.reduce((acc: any, odds: any) => {
      acc[odds.Bookmaker] = (acc[odds.Bookmaker] || 0) + 1;
      return acc;
    }, {});

    console.log("Bookmaker distribution:");
    Object.entries(bookmakerCounts).forEach(([bookmaker, count]) => {
      console.log(`  ${bookmaker}: ${count} odds entries`);
    });

    const oddsTypeCounts = currentOdds.reduce((acc: any, odds: any) => {
      acc[odds.SuperOddsType] = (acc[odds.SuperOddsType] || 0) + 1;
      return acc;
    }, {});

    console.log("Odds type distribution:");
    Object.entries(oddsTypeCounts).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} entries`);
    });
  }

  const historicalTimestamp = Date.now() - 24 * 60 * 60 * 1000;
  console.log(
    `Getting historical odds snapshot for fixture ${TEST_FIXTURE_ID} as of ${new Date(
      historicalTimestamp
    ).toISOString()}...`
  );

  try {
    const historicalOddsResponse = await httpClient.get(
      `/api/odds/snapshot/${TEST_FIXTURE_ID}`,
      {
        params: { asOf: historicalTimestamp },
      }
    );
    const historicalOdds = historicalOddsResponse.data;

    console.log(`Found ${historicalOdds.length} historical odds entries`);
    if (historicalOdds.length > 0) {
      console.log("Sample historical odds entry:", {
        fixtureId: historicalOdds[0].FixtureId,
        messageId: historicalOdds[0].MessageId,
        bookmaker: historicalOdds[0].Bookmaker,
        superOddsType: historicalOdds[0].SuperOddsType,
        timestamp: new Date(historicalOdds[0].Ts).toISOString(),
        prices: historicalOdds[0].Prices?.slice(0, 3),
      });
    }
  } catch (error) {
    console.log(`No historical odds available for the specified timestamp`);
  }

  console.log(`Getting live odds updates for fixture ${TEST_FIXTURE_ID}...`);
  try {
    const liveOddsResponse = await httpClient.get(
      `/api/odds/updates/${TEST_FIXTURE_ID}`
    );
    const liveOdds = liveOddsResponse.data;

    console.log(`Found ${liveOdds.length} live odds updates`);
    if (liveOdds.length > 0) {
      console.log("Latest odds update:", {
        timestamp: new Date(liveOdds[0].Ts).toISOString(),
        bookmaker: liveOdds[0].Bookmaker,
        superOddsType: liveOdds[0].SuperOddsType,
        inRunning: liveOdds[0].InRunning,
        pricesCount: liveOdds[0].Prices?.length,
      });
    }
  } catch (error) {
    console.log(
      `No live odds updates available for fixture ${TEST_FIXTURE_ID}`
    );
  }

  console.log("Getting historical odds updates...");
  try {
    const historicalUpdatesResponse = await httpClient.get(
      `/api/odds/updates/20327/12/20327`
    );
    const historicalUpdates = historicalUpdatesResponse.data;

    console.log(`Found ${historicalUpdates.length} historical odds updates`);
    if (historicalUpdates.length > 0) {
      console.log("Sample historical update:", {
        fixtureId: historicalUpdates[0].FixtureId,
        timestamp: new Date(historicalUpdates[0].Ts).toISOString(),
        bookmaker: historicalUpdates[0].Bookmaker,
        superOddsType: historicalUpdates[0].SuperOddsType,
      });
    }
  } catch (error) {
    console.log("No historical updates available for the specified parameters");
  }
}

if (require.main === module) {
  main().catch(console.error);
}
