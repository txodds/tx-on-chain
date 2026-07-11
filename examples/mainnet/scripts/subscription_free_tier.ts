// Demo subscription and data access for free tier (World Cup)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node  examples/mainnet/scripts/subscription_free_tier.ts

import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as anchor from "@coral-xyz/anchor";
import * as config from '../common/config';
import * as users from '../common/users';
import { InconclusiveError, observeSse, summarizeSse, sseDurationSeconds } from '../common/flow';
import { PublicKey } from "@solana/web3.js";
import axios from "axios";

async function main() {
  const sseSeconds = sseDurationSeconds();
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
  const name = "Trader A (Free Tier)";

  const user = await users.setupUser(
    name,
    walletPath,
    tokenMint,
    connection,
    program,
    1,
    4,
    [],
    undefined,
    undefined
  );
  console.log("Authentication established; credentials are redacted");

  try {
    // Dynamically calculate recent epoch day for free tier competition discovery
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const currentEpochDay = Math.floor(Date.now() / MS_PER_DAY);
    // Scan a recent window to find any available snapshots
    interface OddsSnapshot {
      [key: string]: unknown;
    }
    let sampleOdds: OddsSnapshot | null = null;
    let foundFixtureId: number | null = null;

    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const searchDay = currentEpochDay - dayOffset;
      const awesomeUrl = `/fixtures/snapshot?competitionId=72&startEpochDay=${searchDay}`;
      
      try {
        const response = await users.apiClient.get(awesomeUrl);
        if (response.data && response.data.length > 0) {
          console.log(`Premium Data Response for Epoch ${searchDay}: found fixtures`);
          foundFixtureId = response.data[0].FixtureId;
          break;
        }
      } catch (e) {
        // Continue searching
      }
      await new Promise(r => setTimeout(r, 200));
    }

    if (foundFixtureId) {
      const baseUrl = `/odds/snapshot/${foundFixtureId}?asOf=${Date.now()}`;
      try {
        const response = await users.apiClient.get(baseUrl);
        if (response.data && response.data.length > 0) {
          sampleOdds = response.data[0];
          console.log(`Captured sample odds for validation:`, sampleOdds);
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          console.error("Access denied: verify the league bundle or token status");
        } else {
          console.error("Failed to retrieve odds snapshot:", error);
        }
        // Free tier test can continue to test the SSE stream even if snapshot fails
      }
    } else {
      console.log("No recent historical fixtures found for free tier competition 72, proceeding to stream test.");
    }

    // Harden the odds stream subscription using observeSse
    // We pass expectedFixtureId as undefined to listen to all permitted odds without filtering
    console.log(`\n[Odds] Subscribing to permitted odds updates...`);
    const observation = await observeSse({
      url: `${config.API_BASE_URL}/odds/stream`,
      jwt: () => users.authState.jwt,
      apiToken: () => users.authState.apiToken,
      renewJwt: () => users.renewJwt(name),
      expectedFixtureId: undefined, // Listen to all
      durationSeconds: sseSeconds,
    });
    
    summarizeSse("Odds SSE", observation);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.message);
    } else {
      console.error("Error:", error);
    }
    throw error;
  }
}

main().then(
  () => process.exit(0),
  error => {
    if (error instanceof InconclusiveError) {
      console.error(`INCONCLUSIVE: ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "Free tier example failed");
    process.exit(1);
  },
);