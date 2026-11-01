// Demonstrate fetching the full historical scores log for a specific fixture

// Run from the project root using this command
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/historical_scores.ts

import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import {
  address,
  createSolanaRpc,
} from "@solana/kit";

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);

  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL!");
  const programId = address(programIdString);

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  const tokenMint = address(mintAddress);

  console.log("Program ID:", programId);
  console.log("Token Mint:", tokenMint);

  const walletPath = process.env.ANCHOR_WALLET!;
  const name = "Trader A";

  const user = await users.setupUser(
    name,
    walletPath,
    tokenMint,
    rpc,
    programId,
    1,
    4,
    [],
    undefined,
    undefined   
  );

  try {
    // Fetch scores snapshot for a specific fixture
    async function fetchHistoricalScores(fixtureId: number) {
      const updateUrl = `${config.API_BASE_URL}/scores/historical/${fixtureId}`;
      
      try {
        const response = await users.apiClient.get(updateUrl);
        
        if (response.data.length > 0) {
          console.log(`Scores updates found for fixtureId ${fixtureId}:`, response.data);
        } else {
          console.log("Historical endpoint returned success, but data is empty.");
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Request failed:", error.response?.data || error.message);
        } else {
          console.error("Error:", error);
        }
        process.exit(1);
      }
    }

    // Norway v England -- July 11, 2026
    // await fetchHistoricalScores(18202783);
    // France v Spain -- July 14, 2026
    // await fetchHistoricalScores(18237038);
    // England v Argentina -- July 15, 2026
    // await fetchHistoricalScores(18241006);
    await fetchHistoricalScores(18041503);    

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