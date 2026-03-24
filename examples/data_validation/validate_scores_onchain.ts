import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
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
  console.log("Initializing scores on-chain validation example");

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
  const seq = 401;
  const statKey = 1;
  const statKey2 = 2;

  console.log(
    `\nFetching scores stat validation for fixture ${fixtureId}, seq ${seq}, statKey ${statKey}`
  );
  const validationResponse = await httpClient.get(
    "/api/scores/stat-validation",
    {
      params: {
        fixtureId,
        seq,
        statKey,
        statKey2
      },
    }
  );
  const validation = validationResponse.data;

  console.log("Validation data retrieved");

  const epochDay = Math.floor(validation.ts / (24 * 60 * 60 * 1000));
  const [dailyScoresRootsPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("daily_scores_roots"),
      new BN(epochDay).toArrayLike(Buffer, "le", 2),
    ],
    program.programId
  );

  const scoresRootsAccountInfo = await provider.connection.getAccountInfo(
    dailyScoresRootsPda
  );
  if (!scoresRootsAccountInfo) {
    throw new Error(
      `Daily scores roots account not found for epoch day ${epochDay}`
    );
  }

  console.log(
    `Found daily scores roots account at ${dailyScoresRootsPda.toBase58()}`
  );

  const statToProve = {
    statToProve: {
      key: validation.statToProve.key,
      value: validation.statToProve.value,
      period: validation.statToProve.period,
    },
    eventStatRoot: validation.eventStatRoot,
    statProof: validation.statProof.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    })),
  };

  const predicate = {
    threshold: 11,
    comparison: { lessThan: {} },
  };

  const fixtureProof = validation.subTreeProof.map((node: any) => ({
    hash: node.hash,
    isRightSibling: node.isRightSibling,
  }));

  const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
    hash: node.hash,
    isRightSibling: node.isRightSibling,
  }));

  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: validation.summary.eventStatsSubTreeRoot,
  };

  console.log("\nExecuting on-chain stat validation with single stat");
  const signature1 = await program.methods
    .validateStat(
      new BN(validation.ts),
      fixtureSummary,
      fixtureProof,
      mainTreeProof,
      predicate,
      statToProve,
      null,
      null
    )
    .accounts({
      dailyScoresMerkleRoots: dailyScoresRootsPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000000,
      }),
    ])
    .rpc();

  console.log("Single stat validation transaction confirmed:", signature1);
  console.log(
    `Solana Explorer: https://explorer.solana.com/tx/${signature1}?cluster=devnet`
  );
  console.log(
    `Validated: ${statToProve.statToProve.key} = ${statToProve.statToProve.value} (threshold: ${predicate.threshold})`
  );

  // Now do a two-stat validation
  const stat2 = {
    statToProve: validation.statToProve2,
    eventStatRoot: validation.eventStatRoot,
    statProof: validation.statProof2.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    })),
  };

  const op = { subtract: {} };

  const predicate2 = {
    threshold: 5,
    comparison: { lessThan: {} },
  };

  console.log("\nExecuting two-stat on-chain validation");
  const signature2 = await program.methods
    .validateStat(
      new BN(validation.ts),
      fixtureSummary,
      fixtureProof,
      mainTreeProof,
      predicate2,
      statToProve,
      stat2,
      op
    )
    .accounts({
      dailyScoresMerkleRoots: dailyScoresRootsPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000000,
      }),
    ])
    .rpc();

  console.log("Two-stat validation transaction confirmed:", signature2);
  console.log(
    `Solana Explorer: https://explorer.solana.com/tx/${signature2}?cluster=devnet`
  );
  console.log(
    `Validated: ${statToProve.statToProve.key} = ${statToProve.statToProve.value}, ${stat2.statToProve.key} = ${stat2.statToProve.value} (threshold: ${predicate2.threshold})`
  );
}

if (require.main === module) {
  main().catch(console.error);
}
