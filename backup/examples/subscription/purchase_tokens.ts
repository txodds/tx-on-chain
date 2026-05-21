import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Wallet, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";


const USDT_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "USDT_MINT")!.value as string
);
const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

async function main() {
  console.log("Starting subscription token purchase with USDT");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(idl as Txoracle, provider);

  const [usdtTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdt_treasury")],
    program.programId
  );

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );

  const buyerUsdtAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer as any,
    USDT_MINT,
    provider.wallet.publicKey
  );

  const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer as any,
    SUBSCRIPTION_TOKEN_MINT,
    provider.wallet.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const usdtTreasuryVault = getAssociatedTokenAddressSync(
    USDT_MINT,
    usdtTreasuryPda,
    true,
    TOKEN_PROGRAM_ID
  );

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    SUBSCRIPTION_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const usdtAmount = new anchor.BN(1_000_000); // 1 USDT

  console.log(`Purchasing tokens with ${usdtAmount.toNumber() / 1_000_000} USDT...`);

  const txSignature = await program.methods
    .purchaseSubscriptionTokenUsdt(usdtAmount)
    .accounts({
      buyer: provider.wallet.publicKey,
      usdtMint: USDT_MINT,
      buyerUsdtAccount: buyerUsdtAccount.address,
      usdtTreasuryVault: usdtTreasuryVault,
      usdtTreasuryPda: usdtTreasuryPda,
      subscriptionTokenMint: SUBSCRIPTION_TOKEN_MINT,
      tokenTreasuryVault: tokenTreasuryVault,
      tokenTreasuryPda: tokenTreasuryPda,
      buyerTokenAccount: buyerTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("Transaction Signature:", txSignature);
  console.log(`View on Solana Explorer: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
}

if (require.main === module) {
  main().catch(console.error);
}
