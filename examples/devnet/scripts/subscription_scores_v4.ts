// Demo stat validation V4
// V4 needs a booked fixture (book_fixture) and runs validate_fixture_for_tree -> validate_stat_v4 -> close_worker_ticket per validation
// Optionally pin the fixture with FIXTURE_ID and SEQ; otherwise the first recent scores update is used

// Run with
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores_v4.ts

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor"
import { Txoracle } from "../types/txoracle"
import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config'
import * as users from '../common/users'
import * as proof from '../common/proof'
import axios from "axios"
import { PublicKey } from "@solana/web3.js"
import { EventSource } from 'eventsource'
import BN from "bn.js"
import { inspect } from 'util'
import { IdlTypes } from "@coral-xyz/anchor"
import { SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from "@solana/web3.js"

// Client-chosen worker ticket slot; scores use a different domain than the odds script
const SCORES_DOMAIN = 1
const WORKER_ID = 0

type OracleTypes = IdlTypes<Txoracle>

// Export the specific types needed to build payloads
// Convert Rust PascalCase to camelCase automatically via Anchor IDL
export type NDimensionalStrategy = OracleTypes["nDimensionalStrategy"]
export type StatPredicate = OracleTypes["statPredicate"]
export type BinaryExpression = OracleTypes["binaryExpression"]
export type Comparison = OracleTypes["comparison"]
export type ProofNode = IdlTypes<Txoracle>["proofNode"]
export type ScoreStat = IdlTypes<Txoracle>["scoreStat"]
export type StatLeafV1 = IdlTypes<Txoracle>["statLeafV1"]
export type StatLeafV2 = IdlTypes<Txoracle>["statLeafV2"]

// Define a strict type for the raw backend API response
interface ApiProofNode {
  hash: number[] | Buffer | Uint8Array
  isRightSibling: boolean
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
    []
  )

  // Upgrade the provider to use the real funded Trader wallet
  const userWallet = new anchor.Wallet(user.user)
  const userProvider = new anchor.AnchorProvider(connection, userWallet, anchor.AnchorProvider.defaultOptions())
  
  // Create a new program instance permanently bound to Trader A
  const userProgram = new anchor.Program<Txoracle>(program.idl as Txoracle, userProvider)
  // User public key
  const userKey = userProgram.provider.publicKey!

  try {

    // Fetch the scores snapshot for a specific fixture
    async function getScoresSnapshot(fixtureId: number, asOf?: number) {
      const url = asOf 
        ? `/scores/snapshot/${fixtureId}?asOf=${asOf}` 
        : `/scores/snapshot/${fixtureId}`

      try {
        // Rely on the interceptor to handle headers automatically
        // Pause refresh and resume automatically if the token is expired
        const response = await users.apiClient.get(url)
        
        console.log(`Snapshot for fixture ${fixtureId}:`, response.data)
        return response.data
        
      } catch (error) {
        // Log actual failures rather than 403s
        console.error(`Failed to retrieve scores snapshot for ${fixtureId}:`, error)
        throw error
      }
    }

    var sampleScores: any = null

    // Stat keys requested by the validations below; the widest set is used to check a sample
    const STAT_KEYS = "1002,1007,2007,1"

    // The server cannot prove every update that carries stats (e.g. connected, comment, fumble), and answers 500.
    // The endpoint needs no fixture ticket, so check a sample before paying to book its fixture.
    const canValidate = async (fixtureId: number, seq: number) => {
      try {
        await users.apiClient.get(`/scores/stat-validation-v4?fixtureId=${fixtureId}&seq=${seq}&statKeys=${STAT_KEYS}`)
        return true
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 500) return false
        throw error
      }
    }

    const scanRecentScores = async (fixtureId?: number) => {
      const msPerInterval = 300000 
      const now = new Date()

      // Only fixtures in the schedule are bookable, and stat validation needs a booked one.
      // afterTs defaults to now, which would drop fixtures already under way, so go back almost the 2 weeks allowed.
      // The server measures the 2 weeks from when the request arrives, so exactly 2 weeks is already too early.
      const schedule = await users.apiClient.get<{ FixtureId: number }[]>("/fixtures-schedule", {
        params: { afterTs: now.getTime() - 14 * 86400000 + 3600000 },
      })
      const bookableFixtureIds = new Set(schedule.data.map(f => f.FixtureId))

      // Scan backwards through the last two weeks of intervals
      const intervalsInTwoWeeks = (14 * 86400000) / msPerInterval
      for (let i = 0; i < intervalsInTwoWeeks; i++) {
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
            
            // Capture the first update of a bookable fixture that carries stats and that the server can prove:
            // coverage records have an empty Stats, and not every update with stats has a processed scores record
            const withStats = response.data.filter((u: any) =>
              bookableFixtureIds.has(u.FixtureId) && Object.keys(u.Stats ?? u.Update?.Stats ?? {}).length > 0)
            for (const candidate of withStats) {
              if (await canValidate(candidate.FixtureId, candidate.Update?.Seq ?? candidate.Seq)) {
                sampleScores = candidate
                console.log(`Captured sample for validation: FixtureId ${sampleScores.FixtureId} @ Ts ${sampleScores.Ts}`)
                return
              }
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

    let fixtureId: number
    let seq: number
    if (process.env.FIXTURE_ID && process.env.SEQ) {
      fixtureId = Number(process.env.FIXTURE_ID)
      seq = Number(process.env.SEQ)
    } else {
      await scanRecentScores()
      if (!sampleScores) throw new Error("No recent scores updates found; set FIXTURE_ID and SEQ")
      fixtureId = sampleScores.FixtureId
      seq = sampleScores.Update?.Seq ?? sampleScores.Seq
    }

    console.log(`\n[${name}] Booking fixture ${fixtureId}`)
    const booking = await users.bookFixture(userProgram, tokenMint, fixtureId, name)
    if (booking.status === "no-quote") {
      throw new Error(`Fixture ${fixtureId} is not bookable (no odds and scores, or its competition has no price)`)
    }
    if (booking.status === "booked") {
      console.log(`[${name}] Booked for ${booking.price} TxL base units: ${booking.signature}`)
    } else {
      console.log(`[${name}] Fixture ticket already held`)
    }

    await getScoresSnapshot(fixtureId, Date.now())

    const fixtureTicket = users.fixtureTicketPda(program.programId, userKey, fixtureId)

    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 1_400_000 
    })

    // Define unified strategies
    const strategy1To3Plus: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        { single: { index: 0, predicate: { threshold: 1, comparison: { equalTo: {} } } } },
        { single: { index: 1, predicate: { threshold: 2, comparison: { greaterThan: {} } } } }
      ]
    }

    const strategyDraw: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          binary: {
            indexA: 0,
            indexB: 1,
            op: { subtract: {} }, 
            predicate: { threshold: 0, comparison: { equalTo: {} } }
          }
        }
      ]
    }

    const strategy3Leg: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          binary: {
            indexA: 0,
            indexB: 1,
            op: { subtract: {} }, 
            predicate: { threshold: 0, comparison: { equalTo: {} } }
          }
        },
        { single: { index: 2, predicate: { threshold: 0, comparison: { greaterThan: {} } } } }
      ]
    }

    const strategy4Leg: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          binary: {
            indexA: 0,
            indexB: 1,
            op: { subtract: {} }, 
            predicate: { threshold: 0, comparison: { equalTo: {} } }
          }
        },
        { single: { index: 2, predicate: { threshold: 0, comparison: { greaterThan: {} } } } },
        { single: { index: 3, predicate: { threshold: 0, comparison: { greaterThan: {} } } } }
      ]
    }

    const strategyGeometric: NDimensionalStrategy = {
      geometricTargets: [
        { statIndex: 0, prediction: 0 }, 
        { statIndex: 1, prediction: 1 }
      ],
      distancePredicate: { threshold: 2, comparison: { lessThan: {} } },
      discretePredicates: []
    }

    console.log(`\n[${name}] Initiating V4 validations`)

    const fetchV4Payload = async (keys: string) => {
      const url = `/scores/stat-validation-v4?fixtureId=${fixtureId}&seq=${seq}&statKeys=${keys}`;
      const res = await users.apiClient.get(url, { userName: name } as any)
      const response = res.data

      // Staged on-chain by validate_fixture_for_tree; not part of the co-signed validate_stat_v4 payload
      const treePayload = {
        ts: new BN(response.payload.ts),
        summary: {
          fixtureId: new BN(response.payload.summary.fixtureId),
          updateStats: {
            updateCount: response.payload.summary.updateStats.updateCount,
            minTimestamp: new BN(response.payload.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(response.payload.summary.updateStats.maxTimestamp),
          },
          subTreeRoot: proof.parseHash(response.payload.summary.eventStatsSubTreeRoot),
        },
        mainTreeProof: response.payload.mainTreeProof.map(proof.parseProofNode),
      }

      const common = {
        ts: new BN(response.payload.ts),
        fixtureProof: response.payload.fixtureProof.map(proof.parseProofNode),
        eventStatRoot: proof.parseHash(response.payload.eventStatRoot),
        leafIndices: response.payload.leafIndices,
        multiproofHashes: response.payload.multiproofHashes.map(proof.parseProofNode),
      }

      // The payload is an enum: leaves with a `statProof` are V1, leaves with `isZero` are V2 (which may carry a rawMask)
      const isV1 = response.payload.leaves.every((leaf: any) => leaf.statProof !== undefined)
      const mappedPayload = isV1
        ? {
            v1: {
              ...common,
              leaves: response.payload.leaves.map((leaf: any) => ({
                stat: { key: leaf.stat.key, value: leaf.stat.value, period: leaf.stat.period },
                statProof: leaf.statProof.map(proof.parseProofNode),
              })),
            },
          }
        : {
            v2: {
              ...common,
              leaves: response.payload.leaves.map((leaf: any) => ({
                stat: { key: leaf.stat.key, value: leaf.stat.value, period: leaf.stat.period },
                isZero: leaf.isZero,
              })),
              rawMask: response.payload.rawMask ? proof.parseMask(response.payload.rawMask) : null,
            },
          }

      return {
        treePayload,
        payload: mappedPayload,
        signature: response.signature as string
      }
    }

    const runV4 = async (v4Data: any, strategy: any, label: string) => {
      // A rawMask adds 512 bytes, which no longer fit a legacy transaction (web3.js cannot build v1 transactions)
      if (v4Data.payload.v2?.rawMask) {
        console.log(`[${name}] V4 ${label}: skipped, payload carries a 512-byte rawMask and does not fit a legacy transaction`)
        return
      }

      // Encode payload to raw Borsh bytes
      const serializedPayload: Buffer = userProgram.coder.types.encode(
        "statValidationPayload",
        v4Data.payload
      )

      // A program still on IDL 1.5.14 takes the payload as a struct, without the enum's 1-byte variant tag, and a
      // writable fixture_ticket; its backend signs that layout. Use it when the signature only covers the untagged bytes.
      const legacyLayout = !users.isBackendSigned(serializedPayload, v4Data.signature)
        && users.isBackendSigned(serializedPayload.subarray(1), v4Data.signature)

      const ed25519Ix = users.backendCosignInstruction(
        legacyLayout ? serializedPayload.subarray(1) : serializedPayload,
        v4Data.signature
      )

      const ticket = users.workerTicketPda(program.programId, userKey, SCORES_DOMAIN, WORKER_ID)
      const validateIx = await userProgram.methods
        .validateStatV4(WORKER_ID, v4Data.payload, strategy)
        .accounts({
          user: userKey,
          ticket,
          fixtureTicket,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction()

      if (legacyLayout) {
        // Drop the variant tag, which follows the 8-byte discriminator and the u16 worker id
        validateIx.data = Buffer.concat([validateIx.data.subarray(0, 10), validateIx.data.subarray(11)])
        validateIx.keys.find(k => k.pubkey.equals(fixtureTicket))!.isWritable = true
      }

      const dailyScoresPda = users.dailyRootsPda(program.programId, "daily_scores_roots", v4Data.treePayload.ts.toNumber())

      await userProgram.methods
        .validateFixtureForTree({ ...v4Data.treePayload, domain: SCORES_DOMAIN, workerId: WORKER_ID })
        .accounts({
          payer: userKey,
          ticket,
          dailyMerkleRoots: dailyScoresPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc()

      try {
        const txSignature = await userProvider.sendAndConfirm(
          new Transaction().add(computeBudgetIx, ed25519Ix, validateIx)
        )

        console.log(`[${name}] V4 ${label}: executed with signature ${txSignature}`)
      } finally {
        // Reclaims the worker ticket's rent and frees the slot for the next validation
        // A failed close is logged so it doesn't replace the validation error
        await userProgram.methods
          .closeWorkerTicket(SCORES_DOMAIN, WORKER_ID)
          .accounts({ payer: userKey, ticket })
          .rpc()
          .catch(closeError => console.error("close_worker_ticket failed:", closeError))
      }
    }

    // Fetch dedicated multiproof payloads mapped to strategy leg counts
    const payloadV4_2Leg = await fetchV4Payload("1002,1007")

    const inspectedPayload_2Leg = inspect(payloadV4_2Leg, { depth: null, colors: true })
    const payloadPrefix_2Leg = `[${name}] payload:`
    console.log(payloadPrefix_2Leg, inspectedPayload_2Leg)

    const payloadV4_3Leg = await fetchV4Payload("1002,1007,2007")
    const payloadV4_4Leg = await fetchV4Payload(STAT_KEYS)

    const inspectedPayload_4Leg = inspect(payloadV4_4Leg, { depth: null, colors: true })
    const payloadPrefix_4Leg = `[${name}] payload:`
    console.log(payloadPrefix_4Leg, inspectedPayload_4Leg)

    const validations = [
      { payload: payloadV4_2Leg, strategy: strategy1To3Plus, label: "1:3+ discrete" },
      { payload: payloadV4_2Leg, strategy: strategyDraw, label: "Binary draw" },
      { payload: payloadV4_3Leg, strategy: strategy3Leg, label: "Combined 3-leg" },
      { payload: payloadV4_4Leg, strategy: strategy4Leg, label: "Combined 4-leg" },
      { payload: payloadV4_2Leg, strategy: strategyGeometric, label: "Geometric 2-leg" }
    ]

    // Execute validations sequentially to respect public RPC rate limits
    for (const v of validations) {
      await runV4(v.payload, v.strategy, v.label)
      
      // Delay execution to prevent 429 errors on free public RPC nodes
      await new Promise(resolve => setTimeout(resolve, 1500))
    }

    async function listenToScoresStream(streamId: string): Promise<void> {
      // Define connection states
      const CLOSED_STATE = 2 
      let isReconnecting = false
      
      // Lift state tracker outside the reconnect loop
      let lastSeenId: string | undefined = undefined 

      function connect() {
        console.log(`[Scores - ${streamId}] Subscribing to all scores updates...`)
    
        const streamUrl = `${config.API_BASE_URL}/scores/stream`
    
        const eventSource = new EventSource(streamUrl, {
          fetch: async (input, init) => {
            const attemptFetch = (token: string) => {              
              // Set base headers
              const customHeaders: Record<string, string> = {
                ...(init?.headers as Record<string, string>),
                'Accept-Encoding': 'deflate',
                'Authorization': `Bearer ${token}`,
                'X-Api-Token': users.authState.apiToken,
              }

              // Inject last event ID safely only if the library hasn't already added it
              const alreadyHasId = Object.keys(customHeaders).some(
                key => key.toLowerCase() === 'last-event-id'
              )

              if (lastSeenId && !alreadyHasId) {
                customHeaders['Last-Event-ID'] = lastSeenId
                console.log(`[Scores - ${streamId}] Resuming stream from ID: ${lastSeenId}`)
              }

              return fetch(input, {
                ...init,
                headers: customHeaders,
              })
            }
    
            let response = await attemptFetch(users.authState.jwt)
    
            if (response.status === 403 || response.status === 401) {
              console.log(`[Scores - ${streamId}] SSE connection rejected Renewing JWT...`)
              const newJwt = await users.renewJwt()
              response = await attemptFetch(newJwt)
            }
    
            return response
          },
        })

        eventSource.onmessage = (event) => {
          // Update tracker with ID provided by the server
          if (event.lastEventId) {
            lastSeenId = event.lastEventId
          }
          console.log(`[Scores - ${streamId}] Received payload:`, event.data)
        }
        
        eventSource.onopen = () => {
          console.log(`[Scores - ${streamId}] Stream connection opened`)
          isReconnecting = false 
        }

        eventSource.onerror = (err) => {
          console.error(`[Scores - ${streamId}] Stream connection error or dropped:`, err)
          
          if (eventSource.readyState === CLOSED_STATE) {
            eventSource.close() 
            
            if (!isReconnecting) {
              isReconnecting = true
              console.log(`[Scores - ${streamId}] Reconnecting in 3 seconds...`)
              setTimeout(connect, 3000) 
            }
          }
        }
      }

      connect()
    }

    listenToScoresStream("1")

    const waitDuration = 3601 * 1000
    console.log(`Waiting for ${waitDuration / 1000} seconds for scores to go through...`)
    await new Promise(resolve => setTimeout(resolve, waitDuration))

    // Intercept the 403 renew the JWT and retry
    // await getScoresSnapshot(4, Date.now())

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message)
    } else {
      console.error("Error:", error)
    }
    process.exit(1)
  }

}

main().then(() => process.exit(0))