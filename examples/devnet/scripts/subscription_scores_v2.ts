// Demo subscription and data access for free tier (World Cup)

// Run from the project root using this command BUT REPLACE THE LOCATION OF YOUR WALLET BELOW: ANCHOR_WALLET="./_keys/testuser-wallet-1.json"
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores_v2.ts

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import { PublicKey } from "@solana/web3.js";
import {EventSource} from 'eventsource'
import BN from "bn.js";
import { inspect } from 'util';
import { IdlTypes } from "@coral-xyz/anchor";

type OracleTypes = IdlTypes<Txoracle>;

// Export the specific types we need to build payloads.
// Note: Anchor automatically converts Rust PascalCase to camelCase in the IDL.
export type NDimensionalStrategy = OracleTypes["nDimensionalStrategy"];
export type StatValidationInput = OracleTypes["statValidationInput"];
export type StatPredicate = OracleTypes["statPredicate"];
export type BinaryExpression = OracleTypes["binaryExpression"];
export type Comparison = OracleTypes["comparison"];
export type ProofNode = IdlTypes<Txoracle>["proofNode"];
export type ScoreStat = IdlTypes<Txoracle>["scoreStat"];
export type StatLeaf = IdlTypes<Txoracle>["statLeaf"];

// Define a strict type for the raw backend API response to replace `any`
interface ApiProofNode {
  hash: number[] | Buffer | Uint8Array; 
  isRightSibling: boolean;
}

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
  );
  console.log("API Token:", users.authState.apiToken);
 
  // Upgrade the provider to use the real, funded Trader wallet
  const userWallet = new anchor.Wallet(user.user);
  const userProvider = new anchor.AnchorProvider(connection, userWallet, anchor.AnchorProvider.defaultOptions());
  
  // Create a new program instance permanently bound to Trader A
  const userProgram = new anchor.Program(program.idl, userProvider);

  try {
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

    await getScoresSnapshot(17926686, Date.now());

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
        
        let updateUrl = `/scores/updates/${epochDay}/${hourOfDay}/${interval}`
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

    // Execute the scanner for all scores
    await scanRecentScores()

    // Map API proof array to exact shape Anchor expects
    const mapProof = (proofArray: ApiProofNode[]): ProofNode[] => {
      return proofArray.map(n => ({
        hash: Array.from(n.hash), // Force conversion to number[] for Anchor byte arrays
        isRightSibling: n.isRightSibling,
      }));
    };

    // Fetch single V2 payload requesting four stats at once
    // Note that the statKeys order is important as they are referenced by indexes 0..N in validation strategy predicates
    const url = `/scores/stat-validation?fixtureId=17926686&seq=880&statKeys=1,2`;    

    const response = await users.apiClient.get(url, { userName: name } as any);
    const val = response.data;

    const targetTs = val.summary.updateStats.minTimestamp;
    const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));

    const [dailyScoresPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), new BN(epochDay).toBuffer("le", 2)],
      program.programId
    );

    // Build V2 payload matching Anchor IDL directly from V2 response
    const payload: StatValidationInput = {
      ts: new BN(targetTs),
      fixtureSummary: {
        fixtureId: new BN(val.summary.fixtureId),
        updateStats: {
          updateCount: val.summary.updateStats.updateCount,
          minTimestamp: new BN(val.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(val.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: Array.from(val.summary.eventStatsSubTreeRoot),
      },
      // Phase 1 shared trunk
      fixtureProof: mapProof(val.subTreeProof),
      mainTreeProof: mapProof(val.mainTreeProof),
      eventStatRoot: Array.from(val.eventStatRoot), 
      
      // Phase 2 localised branches mapping dynamic arrays
      stats: val.statsToProve.map((statObj: any, index: number) => ({
        stat: statObj,
        statProof: mapProof(val.statProofs[index])
      }))
    };

    const inspectedPayload = inspect(payload, { depth: null, colors: true });
    const payloadPrefix = `[${name}] payload:`;
    console.log(payloadPrefix, inspectedPayload);

    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 1_400_000 
    });

    const strategy1To3Plus: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        { single: { index: 0, predicate: { threshold: 1, comparison: { equalTo: {} } } } },
        { single: { index: 1, predicate: { threshold: 2, comparison: { greaterThan: {} } } } }
      ]
    };

    const strategyDraw: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          binary: {
            indexA: 0,
            indexB: 1,
            op: { subtract: {} }, 
            predicate: { 
              threshold: 0, 
              comparison: { equalTo: {} }
            }
          }
        }
      ]
    };

    const strategyGeometric: NDimensionalStrategy = {
      geometricTargets: [
        { statIndex: 0, prediction: 0 }, 
        { statIndex: 1, prediction: 1 }
      ],
      distancePredicate: {
        threshold: 2,
        comparison: { lessThan: {} }
      },
      discretePredicates: []
    };

    try {
      console.log(`[${name}] Executing 1:3+ discrete validation`);
      
      const isValid1To3Plus = await userProgram.methods
        .validateStatV2(payload, strategy1To3Plus)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .view();

      if (isValid1To3Plus) {
        console.log(`[${name}] 1:3+ validation passed`);
      } else {
        console.log(`[${name}] 1:3+ validation rejected`);
      }

      console.log(`[${name}] Executing binary draw validation`);
      
      const isValidDraw = await userProgram.methods
        .validateStatV2(payload, strategyDraw)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .view();

      if (isValidDraw) {
        console.log(`[${name}] Binary draw validation passed`);
      } else {
        console.log(`[${name}] Binary draw validation rejected`);
      }

      const isValid2LegGeometric = await userProgram.methods
        .validateStatV2(payload, strategyGeometric)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .view();

      if (isValid2LegGeometric) {
        console.log(`[${name}] Geometric 2-leg validation passed`);
      } else {
        console.log(`[${name}] Geometric 2-leg validation rejected`);
      }

    } catch (err) {
      console.error(`[${name}] V2 validation simulation failed:`, err);
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

    listenToScoresStream("1")

    const waitDuration = 3601 * 1000;
    console.log(`Waiting for ${waitDuration / 1000} seconds for scores to go through...`);
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

main().then(() => process.exit(0));
