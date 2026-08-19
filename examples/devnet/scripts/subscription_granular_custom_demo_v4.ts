// Demonstrate
// - subscription and data access targeting a service level ID with custom selectable league IDs up to the specified limit
// - paid-for validation of odds using the validation credits

// Run with
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_granular_custom_demo_v4.ts

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import TxoracleJson from "../idl/txoracle.json";
import { Txoracle } from "../types/txoracle";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import { AddressLookupTableProgram, ComputeBudgetProgram, Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {EventSource} from 'eventsource'
import { BN } from "bn.js";
import { IdlTypes } from "@coral-xyz/anchor"
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "crypto";

type OracleTypes = IdlTypes<Txoracle>

// Export odds validation IDL types
export type OddsValidationInputV4 = OracleTypes["oddsValidationInputV4"]
export type Odds = OracleTypes["odds"]
export type OddsBatchSummary = OracleTypes["oddsBatchSummary"]
export type OddsUpdateStats = OracleTypes["oddsUpdateStats"]

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
  console.log("API Token:", users.authState.apiToken);

  // Upgrade the provider to use the real funded Trader wallet
  const userWallet = new anchor.Wallet(user.user)
  const userProvider = new anchor.AnchorProvider(connection, userWallet, anchor.AnchorProvider.defaultOptions())
  
  // Create a new program instance permanently bound to Trader A
  const userProgram = new anchor.Program(program.idl, userProvider)
  
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

  // Calculate the start of the last fully closed 5-minute interval
  const INTERVAL_MS = 5 * 60 * 1000;
  const now = Date.now();
  const currentIntervalStart = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
  const lastIntervalStart = currentIntervalStart - INTERVAL_MS;

  // Derive the exact path parameters required by the API
  const targetDate = new Date(lastIntervalStart);
  const epochDay = Math.floor(lastIntervalStart / (24 * 60 * 60 * 1000));
  const hourOfDay = targetDate.getUTCHours(); // Must be UTC to align with epoch timing
  const interval = Math.floor(targetDate.getUTCMinutes() / 5);

  console.log(`Fetching odds updates for Epoch Day: ${epochDay}, Hour: ${hourOfDay}, Interval: ${interval}`);

  // Fetch the odds updates using the time-based path parameters
  // (Assuming apiClient handles the /api base path automatically)
  const updatesResponse = await users.apiClient.get(`/odds/updates/${epochDay}/${hourOfDay}/${interval}`);
  const updates = updatesResponse.data;
  console.log(updates.data);

  if (!updates || updates.length === 0) {
    throw new Error(`No odds updates found for interval ${interval} on hour ${hourOfDay}. Wait for more data to be published.`);
  }

  // Because the endpoint returns all updates in that interval, we can just grab the very first one
  const sampleOdds = updates[0];
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
      const payload = v4Data.payload;

      // Map JSON payload directly from the response wrapper
      const mappedPayload: OddsValidationInputV4 = {
        ts: new BN(payload.ts),
        oddsSnapshot: {
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
        },
        summary: {
          fixtureId: new BN(payload.summary.fixtureId),
          updateStats: {
            updateCount: payload.summary.updateStats.updateCount,
            minTimestamp: new BN(payload.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(payload.summary.updateStats.maxTimestamp),
          },
          oddsSubTreeRoot: Array.from(payload.summary.oddsSubTreeRoot)
        },
        subTreeProof: payload.subTreeProof.map((node: any) => ({
          hash: Array.from(node.hash),
          isRightSibling: node.isRightSibling
        })),
        mainTreeProof: payload.mainTreeProof.map((node: any) => ({
          hash: Array.from(node.hash),
          isRightSibling: node.isRightSibling
        }))
      };

      // Encode payload to raw Borsh bytes
      const serializedPayload = userProgram.coder.types.encode(
        "oddsValidationInputV4",
        mappedPayload
      )

      // Hash payload to compress Ed25519 message to 32 bytes
      const payloadHash = createHash('sha256').update(serializedPayload).digest()
      console.log("TS Borsh Length:   ", serializedPayload.length, "bytes")
      console.log("TS SHA-256 Hash:    ", payloadHash.toString('hex'))

      // Decode base64 signature string from API
      const signatureBuffer = typeof v4Data.signature === 'string' 
        ? Buffer.from(v4Data.signature, 'base64') 
        : Buffer.from(v4Data.signature)

      // Construct Ed25519 instruction using 32-byte hash
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: config.BACKEND_ADMIN_PUBKEY.toBytes(),
        message: payloadHash,
        signature: signatureBuffer,
      })

      // Derive daily batch roots PDA
      const epochDay = Math.floor(mappedPayload.ts.toNumber() / (24 * 60 * 60 * 1000))
      const [dailyBatchRootsPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("daily_batch_roots"),
          new BN(epochDay).toArrayLike(Buffer, "le", 2),
        ],
        userProgram.programId
      )

      // Resolve the user public key to satisfy strict TypeScript definitions
      const userKey = userProgram.provider.publicKey!

      // Derive user validation state PDA
      const [userValidationStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_state"), userKey.toBuffer()],
        userProgram.programId
      )

      // Derive token treasury PDA
      const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_treasury_v2")],
        userProgram.programId
      )

      // Derive user token account
      const userTokenAccount = getAssociatedTokenAddressSync(
        tokenMint,
        userKey,
        false,
        TOKEN_2022_PROGRAM_ID
      )
      
      // Derive token treasury vault
      const tokenTreasuryVault = getAssociatedTokenAddressSync(
        tokenMint,
        tokenTreasuryPda,
        true,
        TOKEN_2022_PROGRAM_ID
      )

      // Purchase validation credits
      console.log("Purchasing validation credits...")
      await userProgram.methods
        .purchaseValidationCredits(1)
        .accounts({
          user: userKey,
          userValidationState: userValidationStatePda,
          tokenMint: tokenMint,
          userTokenAccount: userTokenAccount,
          tokenTreasuryVault: tokenTreasuryVault,
          tokenTreasuryPda: tokenTreasuryPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc()

      // Prepare compute budget instruction
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 500000, 
      })

      console.log("Executing V4 odds validation on-chain...")

      // Get the raw validation instruction instead of executing rpc
      const validateIx = await userProgram.methods
        .validateOddsV4(mappedPayload)
        .accounts({ 
          user: userKey,
          userValidationState: userValidationStatePda,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          dailyOddsMerkleRoots: dailyBatchRootsPda
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
          userValidationStatePda,
          SYSVAR_INSTRUCTIONS_PUBKEY,
          dailyBatchRootsPda,
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
      console.log(`Odds validation V4 executed with signature ${txSignature}`)

      // // Execute state mutating transaction via RPC
      // console.log("Executing V4 odds validation on-chain...")
      // const txSignature = await userProgram.methods
      //   .validateOddsV4(mappedPayload)
      //   .accounts({ 
      //     user: userKey,
      //     userValidationState: userValidationStatePda,
      //     instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      //     dailyOddsMerkleRoots: dailyBatchRootsPda
      //   })
      //   .preInstructions([computeBudgetIx, ed25519Ix])
      //   .rpc()

      // console.log(`Odds validation V4 executed with signature ${txSignature}`)

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
