// Request devnet mock USDT faucet tokens

// Run from the project root using this command
// ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/request_devnet_usdt.ts

import TxoracleJson from "../idl/txoracle.json";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import {
  address,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";

// Program constants
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDT_MINT = address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");

// Precompute instruction discriminator
function getDiscriminator(name: string): Uint8Array {
  return createHash("sha256").update(name).digest().subarray(0, 8);
}

const FAUCET_DISCRIMINATOR = getDiscriminator("global:request_devnet_faucet");

// Compute ATA address natively
async function getAtaAddress(wallet: Address, mint: Address, tokenProgramId: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      getAddressEncoder().encode(wallet),
      getAddressEncoder().encode(tokenProgramId),
      getAddressEncoder().encode(mint)
    ]
  });
  return ata;
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");

  // Initialize network clients
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL");
  const programId = address(programIdString);

  // Resolve keypair path and load signer
  const walletPath = process.env.ANCHOR_WALLET || "_keys/testuser-wallet-2.json";
  const keypairLocation = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);

  let user;
  try {
    const secretKeyString = fs.readFileSync(keypairLocation, "utf8");
    const secretKey = new Uint8Array(JSON.parse(secretKeyString));
    user = await createKeyPairSignerFromBytes(secretKey);
  } catch (err) {
    console.error(`Failed to load keypair at ${keypairLocation}`);
    throw err;
  }

  // Derive program accounts
  const [faucetTrackerPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      getUtf8Encoder().encode("faucet_tracker"),
      getAddressEncoder().encode(user.address)
    ]
  });

  const [usdtTreasuryPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [getUtf8Encoder().encode("usdt_treasury")]
  });

  const userUsdtAta = await getAtaAddress(user.address, USDT_MINT, TOKEN_PROGRAM_ID);

  console.log("Requesting 100 Mock USDT from Program Faucet...");
  console.log("Program ID:", programId);
  console.log("User:", user.address);
  console.log("Tracker:", faucetTrackerPda);
  console.log("User USDT ATA:", userUsdtAta);

  // Construct faucet instruction
  const faucetInstruction: Instruction = {
    programAddress: programId,
    accounts: [
      { address: user.address, role: AccountRole.WRITABLE_SIGNER },
      { address: faucetTrackerPda, role: AccountRole.WRITABLE },
      { address: USDT_MINT, role: AccountRole.WRITABLE },
      { address: userUsdtAta, role: AccountRole.WRITABLE },
      { address: usdtTreasuryPda, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: FAUCET_DISCRIMINATOR,
  };

  try {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const txMessage = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(faucetInstruction, m)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    assertIsTransactionWithBlockhashLifetime(signedTx);
    const txSig = getSignatureFromTransaction(signedTx);

    // Submit and confirm faucet transaction
    await sendAndConfirm(signedTx, { commitment: 'confirmed' });

    console.log("Success");
    console.log(`Tx Signature: ${txSig}`);
    console.log(`View on Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  } catch (error: any) {
    // Inspect nested error context for simulation logs
    const logs =
      error?.context?.logs ||
      error?.cause?.data?.logs ||
      error?.cause?.context?.logs ||
      error?.cause?.logs ||
      error?.logs;

    if (logs && Array.isArray(logs) && logs.length > 0) {
      console.error("Program Error Logs:\n" + logs.join("\n"));
    } else {
      console.error("Transaction failed:", error.message || error);
    }
    process.exit(1);
  }
}

main().catch(console.error);

