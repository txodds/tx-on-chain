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
import { randomBytes, createCipheriv } from "crypto";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

const SERVICE_LEVEL_ID = 1; // Change this to select service tier
const DURATION_WEEKS = 1; // Subscription duration

async function main() {
  console.log("Starting subscription with tokens");

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

  console.log("User Token Account:", userTokenAccount.address.toBase58());

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
  const authResponse = await axios.post("https://oracle-dev.txodds.com/auth/guest/start");
  const jwt = authResponse.data.token;
console.log(jwt)
  // Encrypt JWT for on-chain storage
  const symmetricKey = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", symmetricKey, iv);
  let encryptedPayload = cipher.update(jwt, "utf8", "hex");
  encryptedPayload += cipher.final("hex");
  const finalPayload = Buffer.concat([
    Buffer.from(encryptedPayload, "hex"),
    cipher.getAuthTag(),
  ]);

  const keyStr = symmetricKey.toString("base64url");
  const ivStr = iv.toString("base64url");

  // Check user balance before subscription
  const balanceBefore = await provider.connection.getTokenAccountBalance(
    userTokenAccount.address
  );
  console.log(`\nToken balance before: ${balanceBefore.value.uiAmount}`);

  // Subscribe on-chain
  console.log(
    `\n=== Subscribing: Level ${SERVICE_LEVEL_ID}, Duration ${DURATION_WEEKS} weeks ===`
  );

  const txSig = await program.methods
    .subscribeWithToken(SERVICE_LEVEL_ID, DURATION_WEEKS, finalPayload)
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

  console.log("On-chain subscription successful!");
  console.log("Transaction signature:", txSig);
  console.log(
    `View on Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`
  );

  // Check balances after subscription
  const balanceAfter = await provider.connection.getTokenAccountBalance(
    userTokenAccount.address
  );
  console.log(`Token balance after: ${balanceAfter.value.uiAmount}`);

  const vaultBalance = await provider.connection.getTokenAccountBalance(
    tokenTreasuryVault
  );
  console.log(`Treasury vault balance: ${vaultBalance.value.uiAmount}`);

  console.log("\n=== Activating with API service ===");

  try {
    const activationResponse = await axios.get(`https://oracle-dev.txodds.com/api/token/activate?txsig=${txSig}&key=${keyStr}&iv=${ivStr}`, {
        headers: { Authorization: `Bearer ${jwt}` },
    });

    const apiToken = activationResponse.data.token || activationResponse.data;

    console.log("\n=== ✅ SUBSCRIPTION COMPLETE ===");
    console.log("\n🔑 Your API Credentials:");
    console.log("─".repeat(60));
    console.log(`JWT Token:  ${jwt}`);
    console.log(`API Token:  ${apiToken}`);
    console.log("─".repeat(60));
    console.log("\nUse these tokens to authenticate API requests.");
  } catch (error: any) {
    console.error("\n❌ Activation failed:", error.response?.data || error.message);
    console.log("\n⚠️  On-chain subscription succeeded but off-chain activation failed.");
    console.log("You may need to activate manually with:");
    console.log(`  Transaction: ${txSig}`);
    console.log(`  Key: ${keyStr}`);
    console.log(`  IV: ${ivStr}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
