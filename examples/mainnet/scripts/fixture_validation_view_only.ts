// Demonstrate fixture validation by simulation with view()

// Run with:
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node  examples/mainnet/scripts/fixture_validation_view_only.ts

import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as anchor from "@coral-xyz/anchor";
import * as config from '../common/config';
import * as users from '../common/users';
import { InconclusiveError } from '../common/flow';
import axios from "axios";
import { PublicKey } from '@solana/web3.js';
import { ComputeBudgetProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

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
    undefined,
    undefined
  );
  console.log("Authentication established; credentials are redacted");

  interface FixtureUpdate {
    FixtureId: number;
    Ts: number;
    [key: string]: unknown;
  }

  const scanLast7Days = async (): Promise<FixtureUpdate> => {
    const MS_PER_HOUR = 3600000;
    const now = new Date();

    for (let i = 0; i < 24 * 7; i++) {
      const targetTime = new Date(now.getTime() - (i * MS_PER_HOUR));
      const epochDay = Math.floor(targetTime.getTime() / (24 * MS_PER_HOUR));     
      const hourOfDay = targetTime.getUTCHours();
      
      const updateUrl = `${config.API_BASE_URL}/fixtures/updates/${epochDay}/${hourOfDay}`;
      
      try {
        const response = await users.apiClient.get(updateUrl);
        
        if (response.data.length > 0) {
          const sampleFixture = response.data[0];
          console.log(`Captured sample for validation: FixtureId ${sampleFixture.FixtureId} @ Ts ${sampleFixture.Ts}`);
          return sampleFixture;
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error(`Request Failed for ${updateUrl}:`, error.message);
        } else {
          console.error("Error:", error);
        }
        throw error;
      }
    }
    throw new InconclusiveError("No fixture updates found in the last 7 days");
  };

  const sampleFixture = await scanLast7Days();

  // Perform the fixture snapshot validation view call
  const validationUrl = `${config.API_BASE_URL}/fixtures/validation?fixtureId=${sampleFixture.FixtureId}&timestamp=${sampleFixture.Ts}`;
  try {
    const vResponse = await users.apiClient.get(validationUrl);
    console.log("Validation proof response:", vResponse.data);
    const validation = vResponse.data;

    // Extract the game state and pure identifier
    const packedId = new BN(validation.snapshot.FixtureId);
    const shiftDivisor = new BN(2).pow(new BN(48));
    
    const pureFixtureId = packedId.mod(shiftDivisor);
    const gameState = packedId.div(shiftDivisor);

    console.log(`Packed FixtureId: ${packedId.toString()}`);
    console.log(`Actual FixtureId: ${pureFixtureId.toString()}`);
    console.log(`Game State: ${gameState.toString()}`);

    // Map the API response to Anchor structs
    const snapshot = {
      ts: new BN(validation.snapshot.Ts),
      startTime: new BN(validation.snapshot.StartTime),
      competition: validation.snapshot.Competition,
      competitionId: validation.snapshot.CompetitionId,
      fixtureGroupId: validation.snapshot.FixtureGroupId,
      participant1Id: validation.snapshot.Participant1Id,
      participant1: validation.snapshot.Participant1,
      participant2Id: validation.snapshot.Participant2Id,
      participant2: validation.snapshot.Participant2,
      fixtureId: new BN(validation.snapshot.FixtureId),
      participant1IsHome: validation.snapshot.Participant1IsHome
    };

    const summary = {
      fixtureId: new BN(validation.summary.fixtureId),
      competitionId: validation.summary.competitionId,
      competition: validation.summary.competition,
      updateStats: {
        updateCount: validation.summary.updateStats.updateCount,
        minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
      },
      updateSubTreeRoot: validation.summary.updateSubTreeRoot,
    };

    console.log("Preparing on-chain fixture validation view call...");

    // Derive the daily fixtures roots PDA
    const tsMs = validation.snapshot.Ts;
    const epochDay = Math.floor(tsMs / (24 * 60 * 60 * 1000));
    const windowStartDay = Math.floor(epochDay / 10) * 10;

    // Convert the window start day to a little-endian buffer
    const windowStartBuffer = Buffer.alloc(2);
    windowStartBuffer.writeUInt16LE(windowStartDay, 0);

    const [tenDailyFixturesRootsPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("ten_daily_fixtures_roots"),
        windowStartBuffer
      ],
      program.programId
    );

    console.log(`Targeting PDA: ${tenDailyFixturesRootsPda.toBase58()} for window start day: ${windowStartDay}`);

    // Build the transaction for simulation
    const tx = await program.methods
      .validateFixture(
        snapshot,
        summary,
        validation.subTreeProof,
        validation.mainTreeProof
      )
      .accounts({
        tenDailyFixturesRoots: tenDailyFixturesRootsPda,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 1_000_000, 
        }),
      ])
      .transaction();

    // Set the fee payer and get a recent blockhash
    tx.feePayer = user.user.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    console.log("Executing view simulation to verify cryptographic proofs...");
    const simulation = await connection.simulateTransaction(tx);

    if (simulation.value.err) {
      console.error("Simulation Logs:", simulation.value.logs);
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const unitsConsumed = simulation.value.unitsConsumed;

    if (typeof unitsConsumed !== 'number') {
      throw new Error("Simulation did not return units consumed");
    }

    console.log(`View simulation successful. Consumed CU: ${unitsConsumed}`);
    console.log("The fixture validation proof is cryptographically sound on-chain.");

  } catch (vError) {
    console.error("Validation proof extraction failed:", vError);
    throw vError;
  }
}

main().then(
  () => process.exit(0),
  error => {
    if (error instanceof InconclusiveError) {
      console.error(`INCONCLUSIVE: ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "Fixture validation example failed");
    process.exit(1);
  },
);
