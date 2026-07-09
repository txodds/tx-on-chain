// Demo for fetching the full historical scores log for a specific fixture

// Run from the project root using this command:
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node  examples/mainnet/scripts/historical_scores.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import { PublicKey } from "@solana/web3.js";
import axios from "axios";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    provider
  );
  const connection = provider.connection;

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  const tokenMint = new PublicKey(mintAddress);

  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  const walletPath = process.env.ANCHOR_WALLET!;
  const name = "Trader A";

  const user = await users.setupUser(
    name,
    walletPath,
    tokenMint,
    connection,
    program,
    1,
    4,
    [],
    undefined,  // Alternatively, use a working JWT Token here
    undefined   // Alternatively, use a working API Token here
  )
  console.log("API Token:", users.authState.apiToken);

  try {
    // Fetch the scores snapshot for a specific fixture
    async function fetchHistoricalScores(fixtureId: number) {
      let updateUrl = `${config.API_BASE_URL}/scores/historical/${fixtureId}`;
      
      try {
        const response = await users.apiClient.get(updateUrl)
        
        if (response.data.length > 0) {
          console.log(`Scores updates found for fixtureId ${fixtureId}:`, response.data)
        } else {
          console.log(`Historical endpoint returned success, but data is empty.`);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Request failed:", error.response?.data || error.message)
        } else {
          console.error("Error:", error)
        }
        process.exit(1)
      }
    }

    await fetchHistoricalScores(18187298);

} catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }

}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
