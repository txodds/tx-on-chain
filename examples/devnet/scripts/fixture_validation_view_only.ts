// Demonstrate fixture validation by simulation with view()

// Run with:
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/fixture_validation_view_only.ts

import { PublicKey, Connection, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import BN from "bn.js";
import { loadProgram } from "../../common/utils/programLoader";
import { buildInstruction } from "../../common/utils/instructionBuilders";
import { formatValidationProof } from "../../common/utils/formatter";
import { log } from 'console';

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function initializeConnection(): { connection: Connection; program: any } {
  const rpcUrl = getRequiredEnvVar("ANCHOR_PROVIDER_URL");
  const connection = new Connection(rpcUrl, "confirmed");
  const program = loadProgram("devnet");
  return { connection, program };
}

async function initializeUser(connection: Connection, program: any): Promise<users.User> {
  const mintAddress = getRequiredEnvVar("TOKEN_MINT_ADDRESS");
  const tokenMint = new PublicKey(mintAddress);
  const walletPath = getRequiredEnvVar("ANCHOR_WALLET");

  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  return users.setupUser(
    "Trader A",
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
}

function calculateTimeInterval(now: Date, hoursBack: number): { epochDay: number; hourOfDay: number } {
  const MS_PER_HOUR = 3600000;
  const targetTime = new Date(now.getTime() - (hoursBack * MS_PER_HOUR));
  return {
    epochDay: Math.floor(targetTime.getTime() / (24 * MS_PER_HOUR)),
    hourOfDay: targetTime.getUTCHours(),
  };
}

async function fetchFixtureUpdates(epochDay: number, hourOfDay: number): Promise<any[]> {
  const updateUrl = `${config.API_BASE_URL}/fixtures/updates/${epochDay}/${hourOfDay}`;
  try {
    const response = await users.apiClient.get(updateUrl);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }
}

async function scanHours(user: users.User, hours: number): Promise<any> {
  let sampleFixture: any = null;
  const now = new Date();

  for (let i = hours; i >= 0; i--) {
    const { epochDay, hourOfDay } = calculateTimeInterval(now, i);
    console.log(`Query fixture interval ${i}`);

    const updates = await fetchFixtureUpdates(epochDay, hourOfDay);

    if (updates.length > 0) {
      const targetTime = new Date(now.getTime() - (i * 3600000));
      console.info(`Fixtures updates found for Epoch ${epochDay} Hour ${hourOfDay} (${targetTime.toISOString()}):`, updates);
      if (!sampleFixture && updates[0].Competition == "Premier League") {
        sampleFixture = updates[0];
        console.warn(`Captured sample for validation: FixtureId ${sampleFixture.FixtureId} @ Ts ${sampleFixture.Ts}`);
      }
    }
  }

  return sampleFixture;
}


async function fetchValidationProof(fixtureId: number, timestamp: number): Promise<any> {
  const validationUrl = `${config.API_BASE_URL}/fixtures/validation?fixtureId=${fixtureId}&timestamp=${timestamp}`;
  console.info("fetching validation proof: ", validationUrl);
  const vResponse = await users.apiClient.get(validationUrl);
  console.log("Validation proof response:\n" + formatValidationProof(vResponse.data));
  return vResponse.data;
}

function extractFixtureIdComponents(packedId: number): { pureFixtureId: number; gameState: number } {
  const shiftDivisor = 281474976710656;
  const pureFixtureId = packedId % shiftDivisor;
  const gameState = Math.floor(packedId / shiftDivisor);

  console.log(`Packed FixtureId: ${packedId}`);
  console.log(`Actual FixtureId: ${pureFixtureId}`);
  console.log(`Game State: ${gameState}`);

  return { pureFixtureId, gameState };
}

function normalizeProofNode(node: any): { hash: any; is_right_sibling: boolean } {
  return {
    hash: node.hash instanceof Buffer ? Array.from(node.hash) : node.hash,
    is_right_sibling: typeof node.isRightSibling === "boolean" ? node.isRightSibling : node.is_right_sibling,
  };
}

function normalizeProofs(validation: any): void {
  if (validation.subTreeProof && Array.isArray(validation.subTreeProof)) {
    validation.subTreeProof = validation.subTreeProof.map(normalizeProofNode);
  }
  if (validation.mainTreeProof && Array.isArray(validation.mainTreeProof)) {
    validation.mainTreeProof = validation.mainTreeProof.map(normalizeProofNode);
  }
}

function buildSnapshotStruct(snapshotData: any): any {
  return {
    ts: new BN(snapshotData.Ts),
    start_time: new BN(snapshotData.StartTime),
    competition: snapshotData.Competition,
    competition_id: snapshotData.CompetitionId,
    fixture_group_id: snapshotData.FixtureGroupId,
    participant1_id: snapshotData.Participant1Id,
    participant1: snapshotData.Participant1,
    participant2_id: snapshotData.Participant2Id,
    participant2: snapshotData.Participant2,
    fixture_id: new BN(snapshotData.FixtureId),
    participant1_is_home: snapshotData.Participant1IsHome,
  };
}

function buildSummaryStruct(summaryData: any): any {
  return {
    fixture_id: new BN(summaryData.fixtureId),
    competition_id: summaryData.competitionId,
    competition: summaryData.competition,
    update_stats: {
      update_count: summaryData.updateStats.updateCount,
      min_timestamp: new BN(summaryData.updateStats.minTimestamp),
      max_timestamp: new BN(summaryData.updateStats.maxTimestamp),
    },
    update_sub_tree_root: summaryData.updateSubTreeRoot,
  };
}

function deriveTenDailyFixturesRootsPda(tsMs: number, programId: PublicKey): PublicKey {
  const epochDay = Math.floor(tsMs / (24 * 60 * 60 * 1000));
  const windowStartDay = Math.floor(epochDay / 10) * 10;

  const windowStartBuffer = Buffer.alloc(2);
  windowStartBuffer.writeUInt16LE(windowStartDay, 0);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ten_daily_fixtures_roots"), windowStartBuffer],
    programId
  );

  console.log(`Targeting PDA: ${pda.toBase58()} for window start day: ${windowStartDay}`);
  return pda;
}

function buildValidationInstruction(snapshot: any, summary: any, validation: any, pda: PublicKey, programId: PublicKey): any {
  return buildInstruction(
    "validate_fixture",
    {
      snapshot,
      summary,
      sub_tree_proof: validation.subTreeProof,
      main_tree_proof: validation.mainTreeProof,
    },
    {
      ten_daily_fixtures_roots: pda,
    },
    programId
  );
}

async function buildAndSignTransaction(instruction: any, feePayer: PublicKey, connection: Connection): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      instruction,
    ],
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

async function simulateAndVerifyTransaction(tx: VersionedTransaction, connection: Connection): Promise<number> {
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
  return unitsConsumed;
}

async function validateFixture(
  sampleFixture: any,
  program: any,
  connection: Connection,
  user: users.User
): Promise<void> {
  try {
    console.info("ValidateFixture:", sampleFixture.FixtureId, sampleFixture.Ts);
    const validation = await fetchValidationProof(sampleFixture.FixtureId, sampleFixture.Ts);

    extractFixtureIdComponents(validation.snapshot.FixtureId);
    normalizeProofs(validation);

    const snapshot = buildSnapshotStruct(validation.snapshot);
    const summary = buildSummaryStruct(validation.summary);

    console.log("Preparing on-chain fixture validation view call...");

    const pda = deriveTenDailyFixturesRootsPda(validation.snapshot.Ts, program.programId);
    const validateFixtureIx = buildValidationInstruction(snapshot, summary, validation, pda, program.programId);
    const tx = await buildAndSignTransaction(validateFixtureIx, user.user.publicKey, connection);

    await simulateAndVerifyTransaction(tx, connection);
  } catch (vError) {
    console.error("Validation proof extraction failed:", vError);
  }
}

async function main() {
  const { connection, program } = initializeConnection();
  const user = await initializeUser(connection, program);
  const sampleFixture = await scanHours(user, 72);

  if (sampleFixture) {
    await validateFixture(sampleFixture, program, connection, user);
  }
}

main().then(() => process.exit(0));

