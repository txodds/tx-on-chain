// Demonstrate
// - subscription and data access targeting a service level ID with custom selectable league IDs up to the specified limit
// - booking a fixture and validating one of its odds updates on-chain (validate_fixture_for_tree -> validate_odds_v4 -> close_worker_ticket)

// Run with
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node examples/mainnet/scripts/subscription_granular_custom_demo_v4.ts

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import TxoracleJson from "../idl/txoracle.json";
import { Txoracle } from "../types/txoracle";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import { AddressLookupTableProgram, ComputeBudgetProgram, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {EventSource} from 'eventsource'
import { BN } from "bn.js";
import { IdlTypes } from "@coral-xyz/anchor"
import { createHash } from "crypto";

// Client-chosen worker ticket slot; odds use a different domain than the scores script
const ODDS_DOMAIN = 0
const WORKER_ID = 0

type OracleTypes = IdlTypes<Txoracle>

// Export odds validation IDL types
export type OddsValidationInputV4 = OracleTypes["oddsValidationInputV4"]
export type Odds = OracleTypes["odds"]
export type BatchSummary = OracleTypes["batchSummary"]
export type UpdateStats = OracleTypes["updateStats"]

// Define strict type for raw backend API response
export interface ApiProofNode {
  hash: number[] | Buffer | Uint8Array
  isRightSibling: boolean
}

// Define strict API interfaces for V4 odds validation JSON response
export interface ApiOddsUpdateStats {
  updateCount: number
  minTimestamp: number
  maxTimestamp: number
}

export interface ApiOddsBatchSummary {
  fixtureId: number
  updateStats: ApiOddsUpdateStats
  oddsSubTreeRoot: number[]
}

export interface ApiOdds {
  FixtureId: number
  MessageId: string
  Ts: number
  Bookmaker: string
  BookmakerId: number
  SuperOddsType: string
  GameState?: string | null
  InRunning: boolean
  MarketParameters?: string | null
  MarketPeriod?: string | null
  PriceNames: string[]
  Prices: number[]
}

export interface ApiOddsValidationInputV4 {
  ts: number
  oddsSnapshot: ApiOdds
  summary: ApiOddsBatchSummary
  subTreeProof: ApiProofNode[]
  mainTreeProof: ApiProofNode[]
}

export interface ApiOddsValidationResponseV4 {
  payload: ApiOddsValidationInputV4
  signature: string
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
    "Trader A",
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

  // Upgrade the provider to use the real funded Trader wallet
  const userWallet = new anchor.Wallet(user.user)
  const userProvider = new anchor.AnchorProvider(connection, userWallet, anchor.AnchorProvider.defaultOptions())
  
  // Create a new program instance permanently bound to Trader A
  const userProgram = new anchor.Program<Txoracle>(program.idl as Txoracle, userProvider)
  
  try {
    const awesomeUrl = `${config.API_BASE_URL}/fixtures/snapshot?competitionId=8`;
    const response = await users.apiClient.get(awesomeUrl);

    console.log("Premium Data Response:", response.data);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }

  var sampleFixture: any = null

  const scanLast12Hours = async (user: users.User) => {
    const MS_PER_HOUR = 3600000;
    const now = new Date();

    for (let i = 0; i < 120; i++) {
      const targetTime = new Date(now.getTime() - (i * MS_PER_HOUR));
      const epochDay = Math.floor(targetTime.getTime() / (24 * MS_PER_HOUR));     
      const hourOfDay = targetTime.getUTCHours();
      
      const updateUrl = `${config.API_BASE_URL}/fixtures/updates/${epochDay}/${hourOfDay}`;
      
      try {
        const response = await users.apiClient.get(updateUrl);
        
        if (response.data.length > 0) {
          console.log(`Fixtures updates found for Epoch ${epochDay} Hour ${hourOfDay}:`, response.data);
          // Capture the first fixture to use for validation
          if (!sampleFixture) {
            sampleFixture = response.data[0];
            console.log(`Captured sample for validation: FixtureId ${sampleFixture.FixtureId} @ Ts ${sampleFixture.Ts}`);
          }
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error("Request Failed:", error.response?.data || error.message);
        } else {
          console.error("Error:", error);
        }
        process.exit(1);
      }
    }
  };
  await scanLast12Hours(user);

  console.log(`Captured sample fixture: ${sampleFixture}`)
  
  // Perform the fixture snapshot validation check using the extracted Ts
  if (sampleFixture) {
    const validationUrl = `${config.API_BASE_URL}/fixtures/validation?fixtureId=${sampleFixture.FixtureId}&timestamp=${sampleFixture.Ts}`;
    try {
      const vResponse = await users.apiClient.get(validationUrl);
      console.log("Validation proof response:", vResponse.data);
    } catch (vError) {
      console.error("Validation proof extraction failed:", vError);
    }
  }

  // Odds validation needs a booked fixture, and only fixtures in the schedule are bookable.
  // afterTs defaults to now, which would drop fixtures already under way, so go back the full 2 weeks allowed.
  const INTERVAL_MS = 5 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TWO_WEEKS_MS = 14 * DAY_MS;
  const now = Date.now();
  const scheduleResponse = await users.apiClient.get<{ FixtureId: number }[]>("/fixtures-schedule", {
    params: { afterTs: now - TWO_WEEKS_MS },
  });
  const bookableFixtureIds = new Set(scheduleResponse.data.map(f => f.FixtureId));

  // Walk back from the last fully closed 5-minute interval until an update for a bookable fixture turns up
  let intervalStart = Math.floor(now / INTERVAL_MS) * INTERVAL_MS - INTERVAL_MS;
  let sampleOdds: any;
  let epochDay = 0, hourOfDay = 0, interval = 0;
  for (; !sampleOdds && intervalStart >= now - TWO_WEEKS_MS; intervalStart -= INTERVAL_MS) {
    const targetDate = new Date(intervalStart);
    epochDay = Math.floor(intervalStart / DAY_MS);
    hourOfDay = targetDate.getUTCHours(); // Must be UTC to align with epoch timing
    interval = Math.floor(targetDate.getUTCMinutes() / 5);

    console.log(`Fetching odds updates for Epoch Day: ${epochDay}, Hour: ${hourOfDay}, Interval: ${interval}`);
    const updatesResponse = await users.apiClient.get(`/odds/updates/${epochDay}/${hourOfDay}/${interval}`);
    const updates = updatesResponse.data;
    if (!Array.isArray(updates)) {
      throw new Error(`Unexpected GET /odds/updates/${epochDay}/${hourOfDay}/${interval} response (HTTP ${updatesResponse.status}): ${JSON.stringify(updates)}`);
    }
    sampleOdds = updates.find(u => bookableFixtureIds.has(u.FixtureId ?? u.fixtureId));
  }
  if (!sampleOdds) {
    throw new Error(
      `No odds update for a bookable fixture within the last 2 weeks (${bookableFixtureIds.size} fixtures in GET /fixtures-schedule).`
    );
  }
  const targetMessageId = sampleOdds.MessageId || sampleOdds.messageId;
  const targetTimestamp = Number(sampleOdds.Ts || sampleOdds.ts);
  const targetFixtureId = sampleOdds.FixtureId || sampleOdds.fixtureId;

  console.log(`Discovered target for validation -> Fixture: ${targetFixtureId} | MessageId: ${targetMessageId} | Ts: ${targetTimestamp}`);

  // Perform the odds validation check using the extracted TS
  if (sampleOdds) {
    try {
      const TEST_MESSAGE_ID = sampleOdds.messageId // "1813114350:00003:000256-10011-stab"
      const TEST_TIMESTAMP = sampleOdds.ts // "1769756773596"

      // Fetch V4 validation data from API
      console.log("Getting odds validation data...")
      const vResponse = await users.apiClient.get<ApiOddsValidationResponseV4>("/odds/validation-v4", {
        params: {
          messageId: targetMessageId, 
          ts: targetTimestamp,        
        },
      });
      const v4Data = vResponse.data;
      const payload = v4Data?.payload;
      if (!payload?.summary || !payload.oddsSnapshot) {
        throw new Error(
          `Unexpected /odds/validation-v4 response (HTTP ${vResponse.status}) for messageId ${targetMessageId}, ts ${targetTimestamp}: ${JSON.stringify(v4Data)}`
        );
      }

      // A single-update subtree has no siblings, and the server omits the empty proof
      const parseNodes = (nodes: ApiProofNode[] = []) =>
        nodes.map(node => ({ hash: Array.from(node.hash), isRightSibling: node.isRightSibling }))

      const oddsSnapshot: Odds = {
        fixtureId: new BN(payload.oddsSnapshot.FixtureId),
        messageId: payload.oddsSnapshot.MessageId,
        ts: new BN(payload.oddsSnapshot.Ts),
        bookmaker: payload.oddsSnapshot.Bookmaker,
        bookmakerId: payload.oddsSnapshot.BookmakerId,
        superOddsType: payload.oddsSnapshot.SuperOddsType,
        gameState: payload.oddsSnapshot.GameState || null,
        inRunning: payload.oddsSnapshot.InRunning ?? false,
        marketParameters: payload.oddsSnapshot.MarketParameters || null,
        marketPeriod: payload.oddsSnapshot.MarketPeriod || null,
        priceNames: payload.oddsSnapshot.PriceNames || [],
        prices: payload.oddsSnapshot.Prices || [],
      };

      // The co-signed payload carries the leaf hash, not the odds themselves
      const mappedPayload: OddsValidationInputV4 = {
        ts: new BN(payload.ts),
        oddsLeafHash: Array.from(createHash('sha256').update(userProgram.coder.types.encode("odds", oddsSnapshot)).digest()),
        subTreeProof: parseNodes(payload.subTreeProof),
      };

      // Staged on-chain by validate_fixture_for_tree against the interval's daily batch roots
      const treePayload = {
        ts: new BN(payload.ts),
        domain: ODDS_DOMAIN,
        workerId: WORKER_ID,
        summary: {
          fixtureId: new BN(payload.summary.fixtureId),
          updateStats: {
            updateCount: payload.summary.updateStats.updateCount,
            minTimestamp: new BN(payload.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(payload.summary.updateStats.maxTimestamp),
          },
          subTreeRoot: Array.from(payload.summary.oddsSubTreeRoot),
        },
        mainTreeProof: parseNodes(payload.mainTreeProof),
      };

      // Encode payload to raw Borsh bytes
      const serializedPayload = userProgram.coder.types.encode(
        "oddsValidationInputV4",
        mappedPayload
      )

      const ed25519Ix = users.backendCosignInstruction(serializedPayload, v4Data.signature)

      const dailyBatchRootsPda = users.dailyRootsPda(userProgram.programId, "daily_batch_roots", payload.ts)
      const userKey = userProgram.provider.publicKey!
      const ticketPda = users.workerTicketPda(userProgram.programId, userKey, ODDS_DOMAIN, WORKER_ID)
      const fixtureTicketPda = users.fixtureTicketPda(userProgram.programId, userKey, payload.summary.fixtureId)

      // Odds are only validatable for a booked fixture
      console.log(`Booking fixture ${payload.summary.fixtureId}...`)
      const booking = await users.bookFixture(userProgram, tokenMint, payload.summary.fixtureId, name)
      if (booking.status === "no-quote") {
        throw new Error(`Fixture ${payload.summary.fixtureId} is not bookable (no odds and scores, or its competition has no price)`)
      }
      console.log(booking.status === "booked" ? `Booked: ${booking.signature}` : "Fixture ticket already held")

      console.log("Staging worker ticket...")
      await userProgram.methods
        .validateFixtureForTree(treePayload)
        .accounts({
          payer: userKey,
          ticket: ticketPda,
          dailyMerkleRoots: dailyBatchRootsPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc()

      try {
        // Prepare compute budget instruction
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: 500000, 
        })

        // Get the raw validation instruction instead of executing rpc
        const validateIx = await userProgram.methods
          .validateOddsV4(WORKER_ID, mappedPayload)
          .accounts({ 
            user: userKey,
            ticket: ticketPda,
            fixtureTicket: fixtureTicketPda,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .instruction()

        // Extract funded keypair directly from active session
        const signer = user.user
        const payerPubkey = signer.publicKey

        // Fetch confirmed slot and step backward to guarantee sysvar presence
        const currentSlot = await userProvider.connection.getSlot("confirmed")
        const slot = currentSlot - 10

        // Create address lookup table
        const [lookupTableIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
          authority: payerPubkey,
          payer: payerPubkey,
          recentSlot: slot,
        })

        // Store static accounts in lookup table
        const extendLookupTableIx = AddressLookupTableProgram.extendLookupTable({
          payer: payerPubkey,
          authority: payerPubkey,
          lookupTable: lookupTableAddress,
          addresses: [
            payerPubkey,
            ticketPda,
            fixtureTicketPda,
            SYSVAR_INSTRUCTIONS_PUBKEY,
            userProgram.programId,
            ComputeBudgetProgram.programId
          ],
        })

        // Explicitly set the fee payer to the funded account
        const altTx = new Transaction().add(lookupTableIx, extendLookupTableIx)
        altTx.feePayer = payerPubkey

        console.log("Creating address lookup table...")

        // Submit lookup transaction using the specific user provider
        await userProvider.sendAndConfirm(altTx, [signer])
        
        console.log("Waiting for address lookup table activation...")

        // Poll network until lookup table is fully initialized and populated
        let lookupTableAccount = null
        let retries = 0
        
        // Increased to 25 to account for localnet finalization times (~12-15 seconds)
        while (retries < 25) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Fetch with 'finalized' to ensure the simulation bank will absolutely recognize it
          const response = await userProvider.connection.getAddressLookupTable(
            lookupTableAddress, 
            { commitment: "finalized" }
          )
          
          // Ensure the account exists AND the addresses have been successfully written to it
          if (response.value && response.value.state.addresses.length > 0) {
            lookupTableAccount = response.value
            break
          }
          retries++
        }

        if (!lookupTableAccount) {
          throw new Error("Address lookup table failed to activate within the timeout period")
        }

        console.log("Executing V4 odds validation on-chain...")
        
        // Compile and send final versioned transaction
        const latestBlockhash = await userProvider.connection.getLatestBlockhash()
        const messageV0 = new TransactionMessage({
          payerKey: payerPubkey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [computeBudgetIx, ed25519Ix, validateIx],
        }).compileToV0Message([lookupTableAccount])

        const v0Tx = new VersionedTransaction(messageV0)
        v0Tx.sign([signer])

        // Send transaction
        const txSignature = await userProvider.connection.sendTransaction(v0Tx)
        // The close below must not land before the validation does
        const confirmation = await userProvider.connection.confirmTransaction(
          { signature: txSignature, ...latestBlockhash },
          "confirmed"
        )
        if (confirmation.value.err) {
          throw new Error(`validate_odds_v4 failed: ${JSON.stringify(confirmation.value.err)}`)
        }
        console.log(`Odds validation V4 executed with signature ${txSignature}`)

        // // Execute state mutating transaction via RPC
        // console.log("Executing V4 odds validation on-chain...")
        // const txSignature = await userProgram.methods
        //   .validateOddsV4(WORKER_ID, mappedPayload)
        //   .accounts({ 
        //     user: userKey,
        //     ticket: ticketPda,
        //     fixtureTicket: fixtureTicketPda,
        //     instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        //   })
        //   .preInstructions([computeBudgetIx, ed25519Ix])
        //   .rpc()

        // console.log(`Odds validation V4 executed with signature ${txSignature}`)
      } finally {
        // Reclaims the worker ticket's rent and frees the slot
        // A failed close is logged so it doesn't replace the validation error
        await userProgram.methods
          .closeWorkerTicket(ODDS_DOMAIN, WORKER_ID)
          .accounts({ payer: userKey, ticket: ticketPda })
          .rpc()
          .catch(closeError => console.error("close_worker_ticket failed:", closeError))
      }

    } catch (error) {
      console.error("Odds validation V4 failed:", error)
    }
  }

  // // Fetch odds updates for a specific fixture
  // async function getOddsUpdates(fixtureId: number) {
  //   const sampleTs = sampleOdds.Ts;
  //   const date = new Date(sampleTs);
  //   const epochDay = Math.floor(sampleTs / 86400000);
  //   const hourOfDay = date.getUTCHours();
  //   const interval = Math.floor(date.getUTCMinutes() / 5);

  //   const url = `${API_BASE_URL}/odds/updates/${epochDay}/${hourOfDay}/${interval}`;

  //   console.log(`Polling updates for Fixture ${fixtureId} in 5-min bucket ${interval}...`);

  //   try {
  //     const response = await users.apiClient.get(url, {
  //       params: { fixtureId: fixtureId },
  //     });

  //     console.log(`Odds updates found for Epoch ${epochDay} Hour ${hourOfDay} Interval ${interval}:`, response.data);
  //     return response.data;
  //   } catch (error) {
  //     if (axios.isAxiosError(error) && error.response?.status === 403) {
  //       console.error("Access denied: verify the league bundle or token status");
  //     } else {
  //       console.error("Failed to retrieve odds snapshot:", error);
  //     }
  //     throw error;
  //   }
  // }
  // await getOddsUpdates(1);

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
            console.log(`[Scores - ${streamId}] SSE connection rejected. Renewing JWT...`);
            const newJwt = await users.renewJwt();
            response = await attemptFetch(newJwt);
          }

          return response;

        },
    });

    eventSource.onopen = () => {
      console.log(`[Odds] Stream connection opened.`);
    };

    eventSource.onerror = (err) => {
      console.error(`[Odds] Stream connection error: ${err}`);
    };

    // The odds endpoint emits standard messages, not custom event names
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const prefix = `[Odds] [UPDATE] ${event.lastEventId}):`;
      
      console.log(prefix, data);
    };

    };

  // await listenToOddsStream("1")

  const waitDuration = 3600 * 1000;
  console.log(`Waiting for ${waitDuration / 1000} seconds for odds to go through...`);
  await new Promise(resolve => setTimeout(resolve, waitDuration));

}

main().then(() => process.exit(0));
