import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import fs from "fs";
import { KEYPAIR_PATH, RPC_ENDPOINT, TOKEN_MINT, TxOracleIDL } from "../../config";

const SELL_AMOUNT_TOKENS = 1000;

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

  console.log(`Using user wallet: ${userKeypair.publicKey.toBase58()}`);


  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    TOKEN_MINT,
    userKeypair.publicKey
  );
  console.log("User Token Account:", userTokenAccount.address.toBase58());

  const [solTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_treasury")],
    program.programId
  );

  const [tokenTreasuryVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury")],
    program.programId
  );

  const amountOfTokens = new anchor.BN(SELL_AMOUNT_TOKENS);

  console.log(`Selling ${SELL_AMOUNT_TOKENS} tokens...`);

  const txSignature = await program.methods
    .sellSubscriptionToken(amountOfTokens)
    .accounts({
      seller: userKeypair.publicKey,
      solTreasuryPda: solTreasuryPda,
      tokenTreasuryVault: tokenTreasuryVaultPda,
      sellerTokenAccount: userTokenAccount.address,
      subscriptionTokenMint: TOKEN_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([userKeypair])
    .rpc();

  console.log("Transaction Signature:", txSignature);
}

if (require.main === module) {
  main().catch(console.error);
}
