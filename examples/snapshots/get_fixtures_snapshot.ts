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
  console.log("Initializing fixtures snapshot example");

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

  console.log("\nFetching fixtures snapshot for competition 500005");
  const fixturesResponse = await httpClient.get("/api/fixtures/snapshot", {
    params: {
      competitionId: 500005,
    },
  });
  const fixtures = fixturesResponse.data;

  console.log(`Retrieved ${fixtures.length} fixtures for NCAA Division I FBS`);

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

  console.log("\nFetching fixtures snapshot for all competitions");
  const allFixturesResponse = await httpClient.get("/api/fixtures/snapshot");
  const allFixtures = allFixturesResponse.data;

  console.log(`Retrieved ${allFixtures.length} total fixtures`);

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
