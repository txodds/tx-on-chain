// Demo subscription and data access for free tier (World Cup)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_free_tier.ts

import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as anchor from "@coral-xyz/anchor";
import * as config from '../common/config';
import * as users from '../common/users';
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { EventSource } from 'eventsource'

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
    const awesomeUrl = `/fixtures/snapshot?competitionId=72&startEpochDay=20624`;
    const response = await users.apiClient.get(awesomeUrl);

    console.log("Premium Data Response:", response.data);

    // Fetch the odds snapshot for a specific fixture
    var sampleOdds: any = null

    async function getOddsSnapshot(fixtureId: number, asOf?: number) {
      const baseUrl = `/odds/snapshot/${fixtureId}`;
      const url = asOf ? `${baseUrl}?asOf=${asOf}` : baseUrl;

      try {
        const response = await users.apiClient.get(url);

        console.log(`Snapshot for fixture ${fixtureId}:`, response.data);
        // Capture the first odds to use for validation
        if (!sampleOdds) {
          sampleOdds = response.data[0];
          // console.log(`Captured sample for validation: MessageId ${sampleOdds.MessageId} @ Ts ${sampleOdds.Ts}`);
          console.log(`Captured sample for validation: ${sampleOdds}`);
        }
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          console.error("Access denied: verify the league bundle or token status");
        } else {
          console.error("Failed to retrieve odds snapshot:", error);
        }
        throw error;
      }
    }
    await getOddsSnapshot(17588320, Date.now());

    async function listenToOddsStream(streamId: string): Promise<void> {
      console.log(`[Odds] Subscribing to all permitted odds updates...`);

      const streamUrl = `${config.API_BASE_URL}/odds/stream`;

      const eventSource = new EventSource(streamUrl, {
        fetch: async (input, init) => {
          // Helper to execute the request with a specific token
          const attemptFetch = (token: string) => 
            fetch(input, {
              ...init,
              headers: {
                ...init.headers,
                'Accept-Encoding': 'deflate',
                'Authorization': `Bearer ${token}`,
                'X-Api-Token': users.authState.apiToken,
              },
            });

            // Attempt connection using the current global token
            let response = await attemptFetch(users.authState.jwt);
            // If rejected due to expiration, pause the stream builder, renew, and retry
            if (response.status === 403 || response.status === 401) {
              console.log(`[Odds - ${streamId}] SSE connection rejected. Renewing JWT...`);
              const newJwt = await users.renewJwt();
              response = await attemptFetch(newJwt);
            }

            return response;

          },
      });

      // Process incoming server sent events
      eventSource.onmessage = (event) => {
        console.log(`[Odds - ${streamId}] Received payload:`, event.data);
      };
      
      // Log when the connection opens
      eventSource.onopen = () => {
        console.log(`[Odds - ${streamId}] Stream connection opened.`);
      };

      // Log any connection errors
      eventSource.onerror = (err) => {
        console.error(`[Odds - ${streamId}] Stream connection error:`, err);
      };
    }

    // Execute with unique identifiers
    await Promise.all([
      listenToOddsStream('Instance A'),
      listenToOddsStream('Instance B')
    ]);

    const waitDuration = 3600 * 1000;
    console.log(`Waiting for ${waitDuration / 1000} seconds for odds to go through...`);
    await new Promise(resolve => setTimeout(resolve, waitDuration));

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