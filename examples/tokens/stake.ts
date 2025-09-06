import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";
import { KEYPAIR_PATH, RPC_ENDPOINT, TOKEN_MINT, TxOracleIDL } from "../../config";

async function main() {
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(userKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(TxOracleIDL, provider);

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    TOKEN_MINT,
    userKeypair.publicKey
  );

  const [stakeAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [stakeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), userKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  console.log("Staking tokens...");
  const stakeSignature = await program.methods
    .stake()
    .accounts({
      user: userKeypair.publicKey,
      stakeAccount: stakeAccountPda,
      oracleState: oracleStatePda,
      stakeVault: stakeVaultPda,
      userTokenAccount: userTokenAccount.address,
      tokenMint: TOKEN_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([userKeypair])
    .rpc();

  console.log(`Staking completed: ${stakeSignature}`);
}

main().catch(console.error);