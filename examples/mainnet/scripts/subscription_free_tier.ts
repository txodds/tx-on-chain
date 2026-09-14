// Demo subscription and data access for free tier (World Cup)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node  examples/mainnet/scripts/subscription_free_tier.ts

import { PublicKey, Connection } from "@solana/web3.js";
import * as config from '../common/config';
import * as users from '../common/users';
import { loadProgram } from '../../common/utils/programLoader';
import axios from "axios";
import { EventSource } from 'eventsource'

function initializeConnection() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL is not set");
  return new Connection(rpcUrl, "confirmed");
}

function getTokenMint() {
  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  return new PublicKey(mintAddress);
}

async function setupUserAndAuth(connection: Connection, program: any, tokenMint: PublicKey) {
  const walletPath = process.env.ANCHOR_WALLET!;
  const name = "Trader A";

  await users.setupUser(
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
  console.log("API Token:", users.authState.apiToken);
}

async function fetchFixtureSnapshot() {
  const awesomeUrl = `/fixtures/snapshot?competitionId=8&startEpochDay=20624`;
  const response = await users.apiClient.get(awesomeUrl);
  console.log(awesomeUrl, ": Data Response:", response.data);
  return response.data;
}

async function getOddsSnapshot(fixtureId: number, asOf?: number) {
  const baseUrl = `/odds/snapshot/${fixtureId}`;
  const url = asOf ? `${baseUrl}?asOf=${asOf}` : baseUrl;

  try {
    const response = await users.apiClient.get(url);
    console.log(`Snapshot for fixture ${fixtureId}:`, response.data);
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

function createStreamEventHandlers(streamId: string) {
  return {
    onmessage: (event: MessageEvent) => {
      console.log(`[Odds - ${streamId}] Received payload:`, event.data);
    },
    onopen: () => {
      console.log(`[Odds - ${streamId}] Stream connection opened.`);
    },
    onerror: (err: Event) => {
      console.error(`[Odds - ${streamId}] Stream connection error:`, err);
    }
  };
}

async function fetchWithAuth(input: string | URL, init: RequestInit, streamId: string): Promise<Response> {
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

  let response = await attemptFetch(users.authState.jwt);
  if (response.status === 403 || response.status === 401) {
    console.log(`[Odds - ${streamId}] SSE connection rejected. Renewing JWT...`);
    const newJwt = await users.renewJwt();
    response = await attemptFetch(newJwt);
  }

  return response;
}

async function listenToOddsStream(streamId: string): Promise<void> {
  console.log(`[Odds] Subscribing to all permitted odds updates...`);

  const streamUrl = `${config.API_BASE_URL}/odds/stream`;
  const handlers = createStreamEventHandlers(streamId);

  const eventSource = new EventSource(streamUrl, {
    fetch: (input, init) => fetchWithAuth(input, init, streamId),
  });

  eventSource.onmessage = handlers.onmessage;
  eventSource.onopen = handlers.onopen;
  eventSource.onerror = handlers.onerror;
}

async function waitForOddsProcessing(durationMs: number) {
  console.log(`Waiting for ${durationMs / 1000} seconds for odds to go through...`);
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

async function main() {
  const connection = initializeConnection();
  const program = loadProgram("mainnet");
  const tokenMint = getTokenMint();

  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  try {
    await setupUserAndAuth(connection, program, tokenMint);
    await fetchFixtureSnapshot();
    await getOddsSnapshot(18187298, Date.now());

    await Promise.all([
      listenToOddsStream('Instance A'),
      listenToOddsStream('Instance B')
    ]);

    await waitForOddsProcessing(3600 * 1000);

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