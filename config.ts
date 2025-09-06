import { PublicKey } from "@solana/web3.js";
import txOracleDevnet from "./idl/devnet.json"; 
import txOracleMainnet from "./idl/mainnet.json"; 

const isDevnet = true; // Set to false for mainnet

export const TxOracleIDL = isDevnet ? txOracleDevnet : txOracleMainnet;

export const KEYPAIR_PATH = "/Users/aidan/Development/solana/tx-oracle/devnet-2/keys/testuser-wallet.json";

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
    ? "GYdhNurtx2EgiTPRHVGuFWKHPycdpUqgedVkwEVUWVTC"
    : "sLX1i9dfmsuyFBmJTWuGjjRmG4VPWYK6dRRKSM4BCSx"
);

