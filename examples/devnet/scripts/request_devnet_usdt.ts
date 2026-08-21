// Run from the root project using this command:

// ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/request_devnet_usdt.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import TxoracleJson from "../idl/txoracle.json";
import { Txoracle } from "../types/txoracle";
import { 
  getAssociatedTokenAddressSync, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

async function requestFaucet() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = new Program<Txoracle>(TxoracleJson, provider);

    const user = provider.publicKey;

    const usdtMint = new anchor.web3.PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");

    const [faucetTracker] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_tracker"), user.toBuffer()],
        program.programId
    );

    const [usdtTreasuryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("usdt_treasury")],
        program.programId
    );

    const userUsdtAta = getAssociatedTokenAddressSync(usdtMint, user);

    console.log(`Requesting 100 Mock USDT from Program Faucet...`);
    console.log(`User: ${user.toBase58()}`);
    console.log(`Tracker: ${faucetTracker.toBase58()}`);

    try {
        const signature = await program.methods
            .requestDevnetFaucet()
            .accounts({
                user: user,
                faucetTracker: faucetTracker,
                usdtMint: usdtMint,
                userUsdtAta: userUsdtAta,
                usdtTreasuryPda: usdtTreasuryPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log("Success!");
        console.log(`Tx Signature: ${signature}`);
        console.log(`View on Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    } catch (error: any) {
        if (error.logs) {
            console.error("Program Error Logs:", error.logs);
        } else {
            console.error("Transaction failed:", error.message);
        }
    }
}

requestFaucet().catch(console.error);
