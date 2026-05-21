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
import * as nacl from "tweetnacl";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

const SELECTED_LEAGUES = [500005];

async function main() {
  console.log("Initializing scores snapshot example");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(idl as Txoracle, provider);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: "https://oracle-dev.txodds.com",
  });

  console.log("\nAuthenticating with guest token");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwt = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwt}`;

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
  console.log("User token account:", userTokenAccount.address.toBase58());

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

  console.log("\nSubscribing on-chain (service level 3, duration 1 week)");
  const txSig = await program.methods
    .subscribe(3, 1)
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

  console.log("Transaction confirmed:", txSig);
  console.log(
    `Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`
  );

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, provider.wallet.payer!.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  console.log("Activating API access");
  const activationResponse = await axios.post(
    "https://oracle-dev.txodds.com/api/token/activate",
    {
      txSig,
      walletSignature,
      leagues: SELECTED_LEAGUES,
    },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const apiToken = activationResponse.data.token || activationResponse.data;
  console.log("API access granted");

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  const fixtureId = 17271370;

  console.log(`\nFetching scores snapshot for fixture ${fixtureId}`);

  const snapshotScoresResponse = await httpClient.get(
    `/api/scores/snapshot/${fixtureId}`
  );
  const snapshotScores = snapshotScoresResponse.data;

  console.log(`Retrieved ${snapshotScores.length} snapshot scores entries`);
  if (snapshotScores.length > 0) {
    console.log("Sample snapshot scores entry:", snapshotScores[0]);
  }

  console.log(`\nFetching live scores updates for fixture ${fixtureId}`);
  try {
    const liveScoresResponse = await httpClient.get(
      `/api/scores/updates/${fixtureId}`
    );
    const liveScores = liveScoresResponse.data;

    console.log(`Retrieved ${liveScores.length} live scores updates`);
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
      `\nFetching scores updates for time period (epochDay: ${epochDay}, hour: ${hourOfDay}, interval: ${interval})`
    );

    const historicalUpdatesResponse = await httpClient.get(
      `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`
    );
    const historicalUpdates = historicalUpdatesResponse.data;

    console.log(
      `Retrieved ${historicalUpdates.length} historical scores updates for epoch day ${epochDay}, hour ${hourOfDay}`
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
