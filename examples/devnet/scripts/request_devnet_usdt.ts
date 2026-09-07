// Run from the root project using this command:

// ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/request_devnet_usdt.ts

import { PublicKey, Connection, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { loadProgram } from "../../common/utils/programLoader";
import { buildInstruction } from "../../common/utils/instructionBuilders";
import { setupConnection } from "../../common/utils/setupConnection";

async function requestFaucet() {
    const { connection, keypair } = setupConnection();
    const program = loadProgram("devnet");

    const user = keypair.publicKey;

    const usdtMint = new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");

    const [faucetTracker] = PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_tracker"), user.toBuffer()],
        program.programId
    );

    const [usdtTreasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("usdt_treasury")],
        program.programId
    );

    const userUsdtAta = getAssociatedTokenAddressSync(usdtMint, user);

    console.log(`Requesting 100 Mock USDT from Program Faucet...`);
    console.log(`User: ${user.toBase58()}`);
    console.log(`Tracker: ${faucetTracker.toBase58()}`);

    try {
        const ix = buildInstruction(
            "requestDevnetFaucet",
            {},
            {
                user,
                faucetTracker,
                usdtMint,
                userUsdtAta,
                usdtTreasuryPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            },
            program.programId
        );

        const tx = new Transaction().add(ix);
        tx.feePayer = user;

        const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);

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
