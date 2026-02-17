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
import { randomBytes, createCipheriv } from "crypto";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

async function main() {
  console.log("Starting fixture on-chain validation example");

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
    .subscribeWithToken(1, 1, finalPayload)
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

  const activationResponse = await axios.get(
    `https://oracle-dev.txodds.com/api/token/activate?txsig=${txSignature}&key=${symmetricKey.toString("base64url")}&iv=${iv.toString("base64url")}`,
    { headers: { Authorization: `Bearer ${jwtToken}` } }
  );
  apiToken = activationResponse.data.token || activationResponse.data;
  console.log("API token received");

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  const fixtureId = 17271370;

  console.log(`Getting fixture validation for fixture ${fixtureId}...`);
  const validationResponse = await httpClient.get("/api/fixtures/validation", {
    params: {
      fixtureId,
    },
  });
  const validation = validationResponse.data;

  console.log("Fixture validation data received");

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

  console.log("Executing on-chain fixture validation...");
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

  console.log(`Transaction signature: ${signature}`);
}

if (require.main === module) {
  main().catch(console.error);
}
