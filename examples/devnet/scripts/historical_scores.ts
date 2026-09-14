// Demo for fetching the full historical scores log for a specific fixture

// Run from the project root using this command:
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/historical_scores.ts

import { PublicKey, Connection } from "@solana/web3.js";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import { loadProgram } from "../../common/utils/programLoader";

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL is not set");

  const connection = new Connection(rpcUrl, "confirmed");
  const program = loadProgram("devnet", connection);

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
    "txoracle_api_157b1b042e8c4da690a88849916af909"   // Alternatively, use a working API Token here
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

    // Norway v England -- July 11, 2026
    // await fetchHistoricalScores(18202783); //18213979);
    // France v Spain -- July 14, 2026
    // await fetchHistoricalScores(18237038);
    // England v Argentina -- July 15, 2026
    // await fetchHistoricalScores(18241006);
    // Cincinnati Bengals v Detroit Lions -- July 13, 2026
    await fetchHistoricalScores(18094557);    

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
