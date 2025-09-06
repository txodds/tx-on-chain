import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import fs from "fs";
import {
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  TOKEN_MINT,
  TxOracleIDL,
} from "../../config";

async function main() {
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(userKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
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

  const stakeAccountData = await (program.account as any).stakeAccount.fetch(
    stakeAccountPda
  );
  const isLocked = Date.now() < stakeAccountData.unlockTs.toNumber() * 1000;

  if (isLocked) {
    const unlockTime = new Date(stakeAccountData.unlockTs.toNumber() * 1000);
    throw new Error(`Stake is still locked until ${unlockTime.toISOString()}`);
  }

  console.log("Unstaking tokens...");
  const unstakeSignature = await program.methods
    .unstake()
    .accounts({
      user: userKeypair.publicKey,
      stakeAccount: stakeAccountPda,
      stakeVault: stakeVaultPda,
      userTokenAccount: userTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([userKeypair])
    .rpc();

  console.log(`Unstaking completed: ${unstakeSignature}`);
}

main().catch(console.error);
