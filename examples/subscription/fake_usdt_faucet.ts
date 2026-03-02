import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const USDT_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "USDT_MINT")!.value as string
);

async function main() {
  console.log("Requesting USDT from devnet faucet...");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(idl as Txoracle, provider);

  console.log(`Using wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`USDT Mint: ${USDT_MINT.toBase58()}`);

  // Derive the faucet tracker PDA
  const [faucetTracker] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_tracker"), provider.wallet.publicKey.toBuffer()],
    program.programId
  );

  // Derive the USDT treasury PDA
  const [usdtTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdt_treasury")],
    program.programId
  );

  // Derive the user's USDT ATA
  const [userUsdtAta] = PublicKey.findProgramAddressSync(
    [
      provider.wallet.publicKey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      USDT_MINT.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("Requesting faucet...");

  try {
    const txSignature = await program.methods
      .requestDevnetFaucet()
      .accounts({
        user: provider.wallet.publicKey,
        faucetTracker: faucetTracker,
        usdtMint: USDT_MINT,
        userUsdtAta: userUsdtAta,
        usdtTreasuryPda: usdtTreasuryPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Faucet request successful!");
    console.log("Transaction Signature:", txSignature);
    console.log(`View on Solana Explorer: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
  } catch (error: any) {
    console.error("❌ Faucet request failed:");
    console.error(error.message);
    if (error.logs) {
      console.error("\nProgram logs:");
      error.logs.forEach((log: string) => console.error(log));
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}
