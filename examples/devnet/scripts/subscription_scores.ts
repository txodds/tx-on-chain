// Demo subscription to the scores functionality for the free tier (World Cup and Int Friendlies)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json"  ts-node examples/devnet/scripts/subscription_scores.ts

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
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    provider
  );
  const connection = provider.connection;

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  
  if (!mintAddress) {
    throw new Error("TOKEN_MINT_ADDRESS environment variable is not set!");
  }
  
  const tokenMint = new anchor.web3.PublicKey(mintAddress);
  
  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("Environment variable ANCHOR_WALLET is not set");

  const keypairLocation = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);

  const name = path.basename(walletPath, ".json");
  
  const user = await users.setupUser(
    name,
    keypairLocation,
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
    var sampleScores: any = null

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

    await getScoresSnapshot(17952170, Date.now());

    var sampleScores: any = null

    const scanRecentScores = async (fixtureId?: number) => {
      const msPerInterval = 300000 // Five minutes in milliseconds
      const now = new Date()

      // Scan backwards through the last two hours of intervals
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
          if (axios.isAxiosError(error)) {
            console.error("Request failed:", error.response?.data || error.message)
          } else {
            console.error("Error:", error)
          }
          process.exit(1)
        }
      }
    }

    // Execute the scanner for all fixtures
    await scanRecentScores();

    // Demo stat validation
    const url = `/scores/stat-validation?fixtureId=17952170&seq=941&statKey=1002`;
        
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

    const fixtureProof = validation.subTreeProof.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    }));

    const mainTreeProof = validation.mainTreeProof.map((node: any) => ({
      hash: node.hash,
      isRightSibling: node.isRightSibling,
    }));

    const stat1 = {
      statToProve: validation.statToProve,
      eventStatRoot: validation.eventStatRoot,
      statProof: validation.statProof.map((node: any) => ({
        hash: node.hash,
        isRightSibling: node.isRightSibling,
      })),
    };
    const inspectedStat1 = inspect(stat1, { depth: null, colors: true });
    const statPrefix = `[${name}] stat1:`;
    console.log(statPrefix, inspectedStat1);

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

    async function listenToScoresStream(streamId: string): Promise<void> {
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

    // Execute with unique identifiers
    await Promise.all([
      listenToScoresStream('Instance A'),
      listenToScoresStream('Instance B')
    ]);

    const waitDuration = 3601 * 1000;
    console.log(`Waiting for ${waitDuration / 1000} seconds for odds to go through...`);
    await new Promise(resolve => setTimeout(resolve, waitDuration));

    // This call should intercept the 403, renew the JWT and retry
    await getScoresSnapshot(17952170, Date.now());

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
