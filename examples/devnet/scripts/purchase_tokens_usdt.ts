// Run with
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/purchase_tokens_usdt.ts

import { PublicKey, Connection, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import BN from "bn.js";
import { API_BASE_URL, JWT_URL } from "../common/config";
import * as users from '../common/users';
import { loadProgram } from "../../common/utils/programLoader";

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL is not set");

  const connection = new Connection(rpcUrl, "confirmed");
  const program = loadProgram("devnet");

  const tokenMintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!tokenMintAddress) throw new Error("TOKEN_MINT_ADDRESS not set");
  const tokenMint = new PublicKey(tokenMintAddress);

  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("Environment variable ANCHOR_WALLET is not set");

  const keypairLocation = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);

  const name = path.basename(walletPath, ".json");

  // Pass an empty object to force application/json content type
  const authResponse = await axios.post(JWT_URL, {});
  const jwt = authResponse.data.token;
  console.log(`JWT: ${jwt}`);

  // Load the persistent keypair
  let user: Keypair;
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    user = Keypair.fromSecretKey(secretKey);
    console.log(`[${name}] Wallet loaded: ${user.publicKey.toBase58()}`);
  } catch (err) {
    console.error(`[${name}] Failed to load keypair at ${keypairLocation}`);
    throw err;
  }

  // Derive associated token accounts
  const userSubTokenAccount = getAssociatedTokenAddressSync(tokenMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);

  console.log("Sub Token Mint:", tokenMint.toBase58());

  // Check token associated token account
  const tokenAccountInfo = await connection.getAccountInfo(userSubTokenAccount);
  if (!tokenAccountInfo) {
    console.log(`[${name}] Initializing new token ATA...`);
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: user.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          userSubTokenAccount,
          user.publicKey,
          tokenMint,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([user]);
    const txSignature = await connection.sendTransaction(tx);
    await connection.confirmTransaction(txSignature, "confirmed");
    console.log(`[${name}] Token ATA created`);
  }

  // Acquire 50 TxLINE tokens and pay all necessary fees
  // The amount passed is in whole TxLINE units
  const txlineAmount = 50;

  try {
    // Request transaction quote from the backend
    console.log(`[${name}] Requesting purchase quote from backend...`);
    const quoteResponse = await fetch(`${API_BASE_URL}/guest/purchase/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        buyerPubkey: user.publicKey.toBase58(),
        txlineAmount: txlineAmount
      })
    });

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      throw new Error(`Quote request failed: ${errorText}`);
    }

    // Parse the quote response
    const quoteData = await quoteResponse.json();

    // Display the human readable pricing breakdown
    console.log(`[${name}] Quote received successfully`);
    console.log(` - Base Cost: ${quoteData.baseUsdtCost} USDT`);
    console.log(` - Premium Fee: ${quoteData.feeUsdtAmount} USDT`);
    console.log(` - Total to Charge: ${quoteData.totalUsdtCharged} USDT`);

    // Extract the encoded string using the correct key from the console output
    const txBase64 = quoteData.transactionBase64;

    // Deserialize the encoded transaction
    const txBuffer = Buffer.from(txBase64, "base64");

    const transaction = VersionedTransaction.deserialize(txBuffer);

    // Execute the zero trust safety check
    console.log(`[${name}] Running local safety verification...`);
    users.verifyTransactionSafety(
      transaction,
      user.publicKey,
      program,
      new BN(txlineAmount)
    );
    console.log(`[${name}] Transaction cryptographically verified and safe to sign`);

    // Sign the transaction with the local bot wallet
    console.log(`[${name}] Signing the transaction...`);
    transaction.sign([user]);

    // Submit the fully signed transaction to the network
    console.log(`[${name}] Broadcasting transaction...`);
    const txSignature = await connection.sendTransaction(transaction);

    // Confirm the transaction on the blockchain
    await connection.confirmTransaction(txSignature, "confirmed");
    console.log("M2M purchase successful");
    console.log("Transaction signature:", txSignature);

  } catch (error) {
    console.error("Purchase failed:", error);
  }
}

main().catch(console.error);