import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";
import axios from "axios";
import * as nacl from "tweetnacl";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

const SERVICE_LEVEL_ID = 1; // Change this to select service tier
const DURATION_WEEKS = 1;   // Subscription duration
const SELECTED_LEAGUES: number[] = []; // Standard bundle — no custom league selection

async function main() {
  console.log("Initializing subscription example");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(idl as Txoracle, provider);

  // Get user's subscription token account
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

  // Set up PDAs
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

  // Display pricing matrix
  console.log("\n=== Pricing Matrix ===");
  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  console.log(`Matrix authority: ${matrix.admin.toBase58()}`);

  const tableData = matrix.rows.map((row: any) => ({
    "Row ID": row.rowId,
    "Tokens/Week": Number(row.pricePerWeekToken) / 1_000_000,
    "Sampling (sec)": row.samplingIntervalSec,
    "League Bundle": row.leagueBundleId,
    "Market Bundle": row.marketBundleId,
  }));
  console.table(tableData);

  // Get JWT token from auth service
  console.log("\nAuthenticating with guest token");
  const authResponse = await axios.post("https://oracle-dev.txodds.com/auth/guest/start");
  const jwt = authResponse.data.token;

  // Check user balance before subscription
  const balanceBefore = await provider.connection.getTokenAccountBalance(
    userTokenAccount.address
  );
  console.log(`Token balance before subscription: ${balanceBefore.value.uiAmount}`);

  // Subscribe on-chain
  console.log(
    `\nSubscribing on-chain (service level ${SERVICE_LEVEL_ID}, duration ${DURATION_WEEKS} weeks)`
  );

  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
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

  // Check balances after subscription
  const balanceAfter = await provider.connection.getTokenAccountBalance(
    userTokenAccount.address
  );
  console.log(`Token balance after subscription: ${balanceAfter.value.uiAmount}`);

  const vaultBalance = await provider.connection.getTokenAccountBalance(
    tokenTreasuryVault
  );
  console.log(`Treasury vault balance: ${vaultBalance.value.uiAmount}`);

  // Construct a strict message binding the payment, the intent, and the session
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, provider.wallet.payer!.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  console.log("\nActivating API access");

  try {
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

    console.log("\nSubscription complete");
    console.log("\nAPI Credentials:");
    console.log("─".repeat(60));
    console.log(`JWT Token:  ${jwt}`);
    console.log(`API Token:  ${apiToken}`);
    console.log("─".repeat(60));
    console.log("\nUse these tokens to authenticate API requests");
  } catch (error: any) {
    console.error("\nAPI activation failed:", error.response?.data || error.message);
    console.log("\nNote: On-chain subscription succeeded but API activation failed");
    console.log("Manual activation parameters:");
    console.log(`  Transaction: ${txSig}`);
    console.log(`  Wallet Signature: ${walletSignature}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}