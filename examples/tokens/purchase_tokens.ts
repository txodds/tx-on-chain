import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import {
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  TxOracleIDL,
} from "../../config";

const PURCHASE_AMOUNT_SOL = 0.1;

async function main() {
  console.log("Starting subscription token purchase");

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

  const [tokenTreasuryVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury")],
    program.programId
  );

  const vaultAccount = await getAccount(connection, tokenTreasuryVaultPda);
  const SUBSCRIPTION_TOKEN_MINT = vaultAccount.mint;

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    SUBSCRIPTION_TOKEN_MINT,
    userKeypair.publicKey
  );
  console.log("User Token Account:", userTokenAccount.address.toBase58());

  const [solTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_treasury")],
    program.programId
  );

  const amountOfSol = new anchor.BN(
    PURCHASE_AMOUNT_SOL * anchor.web3.LAMPORTS_PER_SOL
  );

  console.log(`Purchasing tokens with ${PURCHASE_AMOUNT_SOL} SOL...`);

  const txSignature = await program.methods
    .purchaseSubscriptionToken(amountOfSol)
    .accounts({
      buyer: userKeypair.publicKey,
      solTreasury: solTreasuryPda,
      tokenTreasuryVault: tokenTreasuryVaultPda,
      buyerTokenAccount: userTokenAccount.address,
      subscriptionTokenMint: SUBSCRIPTION_TOKEN_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([userKeypair])
    .rpc();

  console.log("Transaction Signature:", txSignature);
}

if (require.main === module) {
  main().catch(console.error);
}
