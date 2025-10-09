import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
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

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    TOKEN_MINT,
    userKeypair.publicKey
  );
  console.log("User Token Account:", userTokenAccount.address.toBase58());

  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  const [tokenTreasuryVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury")],
    program.programId
  );

  let apiToken: string = "";

  console.log("Creating subscription...");

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
    .subscribeWithToken(finalPayload)
    .accounts({
      user: userKeypair.publicKey,
      tokenMint: TOKEN_MINT,
      oracleState: oracleStatePda,
      tokenTreasuryVault: tokenTreasuryVaultPda,
      userTokenAccount: userTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
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

  console.log(`Found ${fixtures.length} fixtures for NCAA Division I FBS`);

  if (!fixtures || fixtures.length === 0) {
    throw new Error("No fixtures found for NCAA Division I FBS");
  }

  const fixture = fixtures[0];

  console.log(
    `Using fixture ${fixture.FixtureId}: ${fixture.Participant1} vs ${fixture.Participant2}`
  );

  const fixtureOddsResponse = await httpClient.get(
    `/api/odds/snapshot/${fixture.FixtureId}`,
    {
      params: { asOf: fixture.StartTime },
    }
  );
  const fixtureOdds = fixtureOddsResponse.data;

  console.log(`Found ${fixtureOdds.length} odds entries`);
  if (fixtureOdds.length > 0) {
    console.log("Sample odds update:", fixtureOdds[0]);
  }

  const hourOfDay = lastSaturday.getHours();
  const interval = Math.floor(lastSaturday.getMinutes() / 5);

  console.log(
    `Getting odds updates for time period (epochDay: ${epochDay}, hour: ${hourOfDay}, interval: ${interval})...`
  );
  try {
    const updatesResponse = await httpClient.get(
      `/api/odds/updates/${epochDay}/${hourOfDay}/${interval}`
    );
    const updates = updatesResponse.data;

    console.log(`Found ${updates.length} odds updates for time period`);
    if (updates.length > 0) {
      console.log("Sample odds update:\n", updates[0]);
    }
  } catch (error) {
    console.log("No odds updates available for the specified time period");
  }
}

if (require.main === module) {
  main().catch(console.error);
}
