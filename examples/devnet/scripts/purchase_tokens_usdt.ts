// Demonstrate token purchasing using USDT quote flow targeting devnet

// Run from the project root using this command
// ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/purchase_tokens_usdt.ts

import TxoracleJson from "../idl/txoracle.json";
import * as users from '../common/users';
import { API_BASE_URL, JWT_URL } from '../common/config';
import axios from "axios";
import * as fs from "fs";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  createKeyPairSignerFromBytes,
  getBase64Encoder,
  getTransactionDecoder,
  signTransaction,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  getCompiledTransactionMessageDecoder
} from "@solana/kit";

async function main() {
  // Initialize connection using environment URL or devnet fallback
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);

  // Establish WebSocket subscriptions client for native confirmation
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

  // Initialize transaction factory to bundle send and confirm steps
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // Resolve keypair path and runtime identity dynamically
  const walletPath = process.env.ANCHOR_WALLET || "_keys/testuser-wallet-2.json";
  const name = "Trader A";

  // Pass empty object to force application/json content type
  const authResponse = await axios.post(JWT_URL, {});
  const jwt = authResponse.data.token;
  console.log(`JWT: ${jwt}`);

  // Load persistent keypair
  let userSigner;
  try {
    const secretKeyString = fs.readFileSync(walletPath, "utf8");
    const secretKey = new Uint8Array(JSON.parse(secretKeyString));
    userSigner = await createKeyPairSignerFromBytes(secretKey);
    console.log(`[${name}] Wallet loaded: ${userSigner.address}`);
  } catch (err) {
    console.error(`[${name}] Failed to load keypair at ${walletPath}`);
    throw err;
  }

  // Set purchase quantity in whole TxLINE units
  const txlineAmount = 50;
  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL");
  const programId = address(programIdString);

  try {
    // Request purchase quote from backend service
    console.log(`[${name}] Requesting purchase quote from backend...`);
    const quoteResponse = await fetch(`${API_BASE_URL}/guest/purchase/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        buyerPubkey: userSigner.address,
        txlineAmount: txlineAmount
      })
    });

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      throw new Error(`Quote request failed: ${errorText}`);
    }

    // Parse inbound quote data
    const quoteData = await quoteResponse.json();

    // Log price breakdown metrics to console
    console.log(`[${name}] Quote received successfully`);
    console.log(` - Base Cost: ${quoteData.baseUsdtCost} USDT`);
    console.log(` - Premium Fee: ${quoteData.feeUsdtAmount} USDT`);
    console.log(` - Total to Charge: ${quoteData.totalUsdtCharged} USDT`);

    // Extract binary string payload
    const txBase64 = quoteData.transactionBase64;
    const txBytes = getBase64Encoder().encode(txBase64);
    const decodedTx = getTransactionDecoder().decode(txBytes);

    // Decode compiled message to extract the original blockhash
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(decodedTx.messageBytes);

    // Fetch latest blockhash to approximate expiration height
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Inject lifetime constraint for confirmation tracking
    const txWithLifetime = {
      ...decodedTx,
      lifetimeConstraint: {
        blockhash: compiledMessage.lifetimeToken,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }
    };

    // Execute security verification rules
    console.log(`[${name}] Running local safety verification...`);
    users.verifyTransactionSafety(
      txWithLifetime,
      userSigner.address,
      programId,
      BigInt(txlineAmount)
    );
    console.log(`[${name}] Transaction cryptographically verified and safe to sign`);

    // Sign transaction with local keypair
    console.log(`[${name}] Signing the transaction...`);
    const signedTx = await signTransaction([userSigner.keyPair], txWithLifetime);

    // Broadcast signed transaction payload to cluster and await finality
    console.log(`[${name}] Broadcasting transaction and waiting for confirmation...`);

    // Suppress compiler warning due to void return type mismatch in SDK
    // @ts-expect-error
    await sendAndConfirmTransaction(signedTx, { commitment: "confirmed" });

    // Extract transaction signature for logging
    const txSignature = getSignatureFromTransaction(signedTx);
    console.log("M2M purchase successful");
    console.log("Transaction signature:", txSignature);

  } catch (error) {
    console.error("Purchase failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);