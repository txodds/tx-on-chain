import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";

export interface ConnectionSetup {
  connection: Connection;
  keypair: Keypair;
  publicKey: string;
}

export function setupConnection(): ConnectionSetup {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) {
    throw new Error("ANCHOR_PROVIDER_URL environment variable is not set");
  }

  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    throw new Error("ANCHOR_WALLET environment variable is not set");
  }

  let keypair: Keypair;
  try {
    const secretKeyString = fs.readFileSync(walletPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    keypair = Keypair.fromSecretKey(secretKey);
  } catch (err) {
    throw new Error(`Could not load keypair from ${walletPath}: ${err}`);
  }

  const connection = new Connection(rpcUrl, "confirmed");

  return {
    connection,
    keypair,
    publicKey: keypair.publicKey.toBase58(),
  };
}
