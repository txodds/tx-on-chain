import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
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

const SELECTED_LEAGUES: number[] = [];

async function main() {
  console.log("Initializing fixture on-chain validation example");

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

  console.log("\nSubscribing on-chain (service level 1, duration 1 week)");
  const txSig = await program.methods
    .subscribe(1, 1)
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

  console.log(`\nFetching fixture validation data for fixture ${fixtureId}`);
  const validationResponse = await httpClient.get("/api/fixtures/validation", {
    params: {
      fixtureId,
    },
  });
  const validation = validationResponse.data;

  console.log("Validation data retrieved");

  const validationEpochDay = new BN(
    Math.floor(validation.snapshot.Ts / (24 * 60 * 60 * 1000))
  );

  const alignedEpochDay = Math.floor(validationEpochDay.toNumber() / 10) * 10;

  const [tenDailyFixturesRootsPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ten_daily_fixtures_roots"),
      new BN(alignedEpochDay).toArrayLike(Buffer, "le", 2),
    ],
    program.programId
  );

  const merkleRootAccountInfo = await provider.connection.getAccountInfo(
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

  console.log("\nExecuting on-chain fixture validation");
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
    .rpc();

  console.log("Validation transaction confirmed:", signature);
  console.log(
    `Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
}

if (require.main === module) {
  main().catch(console.error);
}
