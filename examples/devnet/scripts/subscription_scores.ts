// Demo subscription to the scores functionality for the free tier (World Cup and Int Friendlies)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores.ts

// For a specific fixture, statkey and seq, use this:
// FIXTURE_ID=18146852 STAT_KEY=1002 SEQ=941 TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores.ts 

import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import * as os from "os";
import * as path from "path";
import { EventSource } from 'eventsource'
import { inspect } from 'util';


async function main() {
  const { program, tokenMint, fixtureId , seq, statKey} = setupProgram();
  const name = await setupWalletUser(program, tokenMint);

  try {
    await getScoresSnapshot(fixtureId, Date.now());

    // Execute the scanner for all fixtures
    await scanRecentScores();

    await validateStatOnChain(program, name, fixtureId, seq, statKey);

    // Execute with unique identifiers
    listenToScoresStream('Instance A');
    listenToScoresStream('Instance B');

    const waitDuration = users.streamTtlMs(3601);
    console.log(`Waiting for ${waitDuration / 1000} seconds for odds to go through...`);
    await new Promise(resolve => setTimeout(resolve, waitDuration));

    // This call should intercept the 403, renew the JWT and retry
    await getScoresSnapshot(fixtureId, Date.now());

  } catch (error) {
    console.error("ERR324");
    logRequestError("Request Failed:", error);
    process.exit(1);
  }
}

function setupProgram() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    provider
  );

  let fixtureId = Number(process.env.FIXTURE_ID) || 17952170
  let statKey = process.env.STAT_KEY || "1002"
  let seq = Number(process.env.SEQ) || 941

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) {
    throw new Error("TOKEN_MINT_ADDRESS environment variable is not set!");
  }

  const tokenMint = new anchor.web3.PublicKey(mintAddress);

  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  return { program, tokenMint, fixtureId, seq, statKey };
}

// Sets up the wallet's subscription and API auth; returns the user name derived from the wallet file
async function setupWalletUser(program: Program<Txoracle>, tokenMint: anchor.web3.PublicKey): Promise<string> {
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("Environment variable ANCHOR_WALLET is not set");

  const keypairLocation = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);

  const name = path.basename(walletPath, ".json");

  await users.setupUser(
    name,
    keypairLocation,
    tokenMint,
    program.provider.connection,
    program,
    1,
    4,
    [],
    undefined,  // Alternatively, use a working JWT Token here
    undefined   // Alternatively, use a working API Token here
  )

  return name;
}

function logRequestError(prefix: string, error: unknown) {
  if (axios.isAxiosError(error)) {
    console.error(prefix, error.response?.data || error.message);
  } else {
    console.error("Error:", error);
  }
}

// Fetch the scores snapshot for a specific fixture
async function getScoresSnapshot(fixtureId: number, asOf?: number) {
  const url = asOf
    ? `/scores/snapshot/${fixtureId}?asOf=${asOf}`
    : `/scores/snapshot/${fixtureId}`;

  try {
    // Note: No headers are manually passed here. The interceptor handles it.
    // If the token is expired, this will pause, refresh, and resume automatically.
    const response = await users.apiClient.get(url);

    console.log(`Snapshot for fixture ${fixtureId}:`, response.data);
    return response.data;

  } catch (error) {
    // This will only log actual failures (e.g. 500s, invalid IDs), not 403s.
    console.error(`Failed to retrieve odds snapshot for ${fixtureId}:`, error);
    throw error;
  }
}

// Scan backwards through the last two hours of 5-minute intervals; returns the first score update found
async function scanRecentScores(fixtureId?: number): Promise<any> {
  const msPerInterval = 300000 // Five minutes in milliseconds
  const now = new Date()
  let sampleScores: any = null

  for (let i = 0; i < 24; i++) {
    const targetTime = new Date(now.getTime() - (i * msPerInterval))
    const epochDay = Math.floor(targetTime.getTime() / 86400000)
    const hourOfDay = targetTime.getUTCHours()
    const interval = Math.floor(targetTime.getUTCMinutes() / 5)

    let updateUrl = `${config.API_BASE_URL}/scores/updates/${epochDay}/${hourOfDay}/${interval}`
    if (fixtureId) {
      updateUrl += `?fixtureId=${fixtureId}`
    }

    try {
      console.error(updateUrl)
      const response = await users.apiClient.get(updateUrl)

      if (response.data.length > 0) {
        console.log(`Scores updates found for Epoch ${epochDay} Hour ${hourOfDay} Interval ${interval}:`, response.data)

        // Capture the first score update to use for validation
        if (!sampleScores) {
          sampleScores = response.data[0]
          console.log(`Captured sample for validation: FixtureId ${sampleScores.FixtureId} @ Ts ${sampleScores.Ts}`)
        }
      }
    } catch (error) {
      console.error("ERR119");
      logRequestError("Request failed:", error);
      process.exit(1)
    }
  }

  return sampleScores
}

function toProof(nodes: any[]) {
  return nodes.map((node: any) => ({
    hash: node.hash,
    isRightSibling: node.isRightSibling,
  }));
}

// Demo stat validation: fetch the proofs from the API, then check them on-chain via RPC simulation
async function validateStatOnChain(program: Program<Txoracle>, name: string, fixtureId: number, seq: number, statKey: string) {
  const url = `/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`;
  console.log(url)

  const response = await users.apiClient.get(url, {
    userName: name
  } as any);

  const validation = response.data;

  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: validation.summary.eventStatsSubTreeRoot,
  };

  const fixtureProof = toProof(validation.subTreeProof);
  const mainTreeProof = toProof(validation.mainTreeProof);

  const stat1 = {
    statToProve: validation.statToProve,
    eventStatRoot: validation.eventStatRoot,
    statProof: toProof(validation.statProof),
  };
  console.log(`[${name}] stat1:`, inspect(stat1, { depth: null, colors: true }));

  // Extract the exact timestamp the contract expects
  const targetTs = validation.summary.updateStats.minTimestamp;
  const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));

  const [dailyScoresPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("daily_scores_roots"),
      new BN(epochDay).toBuffer("le", 2),
    ],
    program.programId
  );

  console.log(`[${name}] Found daily batch roots account at ${dailyScoresPda.toBase58()}`);
  console.log(`[${name}] Executing a 1-stat validation via RPC simulation`);

  const predicate = {
    threshold: 0,
    comparison: { greaterThan: {} },
  };

  // Create the compute budget instruction explicitly
  const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000
  });

  try {
    // Use view method to simulate the transaction and deserialize the boolean automatically
    // Chain preInstructions to ensure the RPC allocates enough compute units
    const isValid = await program.methods
      .validateStat(
        new BN(targetTs),
        fixtureSummary,
        fixtureProof,
        mainTreeProof,
        predicate,
        stat1,
        null,
        null
      )
      .accounts({
        dailyScoresMerkleRoots: dailyScoresPda
      })
      .preInstructions([computeBudgetIx])
      .view();

    if (isValid) {
      console.log(`[${name}] On-chain stat validation passed`);
    } else {
      console.log(`[${name}] On-chain stat validation rejected the predicate`);
    }
  } catch (err) {
    console.error(`[${name}] Validation simulation failed:`, err);
  }
}

// Subscribe to the scores SSE stream, renewing the JWT on rejection and resuming from the last seen event on reconnect
function listenToScoresStream(streamId: string): void {
  // Define connection states
  const CLOSED_STATE = 2;
  let isReconnecting = false;

  // Lift state tracker outside the reconnect loop
  let lastSeenId: string | undefined = undefined;

  function connect() {
    console.log(`[Scores - ${streamId}] Subscribing to all scores updates...`);

    const streamUrl = `${config.API_BASE_URL}/scores/stream`;

    const eventSource = new EventSource(streamUrl, {
      fetch: async (input, init) => {
        const attemptFetch = (token: string) => {
          // Set base headers
          const customHeaders: Record<string, string> = {
            ...(init?.headers as Record<string, string>),
            'Accept-Encoding': 'deflate',
            'Authorization': `Bearer ${token}`,
            'X-Api-Token': users.authState.apiToken,
          };

          // Safely inject last event ID only if the library hasn't already added it
          const alreadyHasId = Object.keys(customHeaders).some(
            key => key.toLowerCase() === 'last-event-id'
          );

          if (lastSeenId && !alreadyHasId) {
            customHeaders['Last-Event-ID'] = lastSeenId;
            console.log(`[Scores - ${streamId}] Resuming stream from ID: ${lastSeenId}`);
          }

          return fetch(input, {
            ...init,
            headers: customHeaders,
          });
        };

        let response = await attemptFetch(users.authState.jwt);

        if (response.status === 403 || response.status === 401) {
          console.log(`[Scores - ${streamId}] SSE connection rejected. Renewing JWT...`);
          const newJwt = await users.renewJwt();
          response = await attemptFetch(newJwt);
        }

        return response;
      },
    });

    eventSource.onmessage = (event) => {
      // Update tracker with ID provided by the server
      if (event.lastEventId) {
        lastSeenId = event.lastEventId;
      }
      console.log(`[Scores - ${streamId}] Received payload:`, event.data);
    };

    eventSource.onopen = () => {
      console.log(`[Scores - ${streamId}] Stream connection opened.`);
      isReconnecting = false;
    };

    eventSource.onerror = (err) => {
      console.error(`[Scores - ${streamId}] Stream connection error or dropped:`, err);

      if (eventSource.readyState === CLOSED_STATE) {
        eventSource.close();

        if (!isReconnecting) {
          isReconnecting = true;
          console.log(`[Scores - ${streamId}] Reconnecting in 3 seconds...`);
          setTimeout(connect, 3000);
        }
      }
    };
  }

  connect();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
