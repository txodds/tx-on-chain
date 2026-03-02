import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { randomBytes, createCipheriv } from "crypto";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

const SELECTED_LEAGUES = [500005];

async function main() {
  console.log("Starting scores snapshot example");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(idl as Txoracle, provider);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: "https://oracle-dev.txodds.com",
  });

  console.log("Authenticating...");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwtToken = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwtToken}`;

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer as any,
    SUBSCRIPTION_TOKEN_MINT,
    provider.wallet.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("User Token Account:", userTokenAccount.address.toBase58());

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

  const keyStr = symmetricKey.toString("base64url");
  const ivStr = iv.toString("base64url");

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    SUBSCRIPTION_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const txSignature = await program.methods
    .subscribeWithToken(3, 1, finalPayload)
    .accounts({
      user: provider.wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: SUBSCRIPTION_TOKEN_MINT,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const activationResponse = await axios.post(
    `https://oracle-dev.txodds.com/api/token/activate?txsig=${txSignature}&key=${keyStr}&iv=${ivStr}`,
    { leagues: SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwtToken}` } }
  );
  apiToken = activationResponse.data.token || activationResponse.data;
  console.log("API token received");

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  const fixtureId = 17271370;

  console.log(`Using fixture ${fixtureId}`);

  const snapshotScoresResponse = await httpClient.get(
    `/api/scores/snapshot/${fixtureId}`
  );
  const snapshotScores = snapshotScoresResponse.data;

  console.log(`Found ${snapshotScores.length} snapshot scores entries`);
  if (snapshotScores.length > 0) {
    console.log("Sample snapshot scores entry:", snapshotScores[0]);
  }

  console.log(`Getting live scores updates for fixture ${fixtureId}...`);
  try {
    const liveScoresResponse = await httpClient.get(
      `/api/scores/updates/${fixtureId}`
    );
    const liveScores = liveScoresResponse.data;

    console.log(`Found ${liveScores.length} live scores updates`);
    if (liveScores.length > 0) {
      console.log("Latest scores update:", liveScores[0]);
    }
  } catch (error) {
    console.log(`No live scores updates available for fixture ${fixtureId}`);
  }

  try {
    const epochDay = 20085;
    const hourOfDay = 15;
    const interval = 0;

    console.log(
      `Getting scores updates for time period (epochDay: ${epochDay}, hour: ${hourOfDay}, interval: ${interval})...`
    );

    const historicalUpdatesResponse = await httpClient.get(
      `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`
    );
    const historicalUpdates = historicalUpdatesResponse.data;

    console.log(
      `Found ${historicalUpdates.length} historical scores updates for epoch day ${epochDay}, hour ${hourOfDay}`
    );
    if (historicalUpdates.length > 0) {
      console.log("Sample historical update:", historicalUpdates[0]);
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
