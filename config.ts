import { PublicKey } from "@solana/web3.js";
import txOracleDevnet from "./idl/devnet.json"; 
import txOracleMainnet from "./idl/mainnet.json"; 
import * as anchor from "@coral-xyz/anchor";

const isDevnet = true; // Set to false for mainnet

export const TxOracleIDL = isDevnet ? txOracleDevnet as anchor.Idl : txOracleMainnet as anchor.Idl;

export const KEYPAIR_PATH = "";

export const USER2_KEYPAIR_PATH = "";

export const RPC_ENDPOINT = isDevnet 
  ? "https://api.devnet.solana.com"
  : "https://api.mainnet-beta.solana.com";

export const BASE_URL = isDevnet
  ? "https://oracle-dev.txodds.com"
  : "https://oracle.txodds.com";

export const AUTHORITY_PK = new PublicKey(
  isDevnet
    ? "4oFJ329DuStxuRu7xzHEZH6g6TJhCk3KS6W7ymTVAToz"
    : "7z4Le9errcNrwBqVMJaSHdadMHRV5YTvXpFZKcmeKrCf" 
);

export const TOKEN_MINT = new PublicKey(
  isDevnet
    ? "5Uw386Bcze69DSL8CfCtWKxSv4kqx23A4kZMGAnnEdbj"
    : "sLX1i9dfmsuyFBmJTWuGjjRmG4VPWYK6dRRKSM4BCSx"
);