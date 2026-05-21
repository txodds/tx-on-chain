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

const SELECTED_LEAGUES = [8];

async function main() {
  console.log("Initializing odds on-chain validation example");

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

  const messageId = "1814961080:00003:000084-10011-stab";
  const ts = 1770845011255;

  console.log("\nFetching odds validation data");
  const validationResponse = await httpClient.get("/api/odds/validation", {
    params: { messageId, ts },
  });
  const validation = validationResponse.data;

  console.log("Validation data retrieved");

  const validationEpochDay = Math.floor(
    validation.odds.Ts / (24 * 60 * 60 * 1000)
  );

  const [dailyBatchRootsPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("daily_batch_roots"),
      new BN(validationEpochDay).toArrayLike(Buffer, "le", 2),
    ],
    program.programId
  );

  console.log(
    `Found daily batch roots account at ${dailyBatchRootsPda.toBase58()}`
  );

  const convertToUnsignedBytes = (hash: number[]): number[] => {
    if (!hash) return [];
    return hash.map((byte) => (byte < 0 ? byte + 256 : byte));
  };

  const odds = {
    fixtureId: new BN(validation.odds.FixtureId),
    messageId: validation.odds.MessageId,
    ts: new BN(validation.odds.Ts),
    bookmaker: validation.odds.Bookmaker,
    bookmakerId: validation.odds.BookmakerId,
    superOddsType: validation.odds.SuperOddsType,
    gameState: validation.odds.GameState || null,
    inRunning: validation.odds.InRunning,
    marketParameters: validation.odds.MarketParameters || null,
    marketPeriod: validation.odds.MarketPeriod || null,
    priceNames: validation.odds.PriceNames,
    prices: validation.odds.Prices,
  };

  const summary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    oddsSubTreeRoot: convertToUnsignedBytes(validation.summary.oddsSubTreeRoot),
  };

  const subTreeProof = validation.subTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
    hash: convertToUnsignedBytes(node.hash),
    isRightSibling: node.isRightSibling,
  }));

  console.log("\nExecuting on-chain odds validation");
  const signature = await program.methods
    .validateOdds(
      new BN(validation.odds.Ts),
      odds,
      summary,
      subTreeProof,
      mainTreeProof
    )
    .accounts({
      dailyOddsMerkleRoots: dailyBatchRootsPda,
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
