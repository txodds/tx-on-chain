// Demo stat validation using rich multi-leg strategies

// Run with
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores_1stat.ts

import { PublicKey, Connection, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import * as users from '../common/users';
import axios from "axios";
import BN from "bn.js";
import { inspect } from 'util';
import { loadProgram } from '../../common/utils/programLoader';
import { buildInstruction } from '../../common/utils/instructionBuilders';

// Type definitions from Anchor IDL (kept for type safety)
export type NDimensionalStrategy = any;
export type StatValidationInput = any;
export type StatPredicate = any;
export type BinaryExpression = any;
export type Comparison = any;
export type ProofNode = any;
export type ScoreStat = any;
export type StatLeaf = any;

// Define a strict type for the raw backend API response to replace `any`
interface ApiProofNode {
  hash: number[] | Buffer | Uint8Array;
  isRightSibling: boolean;
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL is not set");

  const connection = new Connection(rpcUrl, "confirmed");
  const program = loadProgram("devnet");

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
  // console.log("API Token:", users.authState.apiToken);

  try {
    // Map API proof array to exact shape Anchor expects
    const mapProof = (proofArray: ApiProofNode[]): ProofNode[] => {
      return proofArray.map(n => ({
        hash: Array.from(n.hash), // Force conversion to number[] for Anchor byte arrays
        isRightSibling: n.isRightSibling,
      }));
    };

    // Fetch single V2 payload requesting four stats at once
    const url = `/scores/stat-validation?fixtureId=18179550&seq=1315&statKeys=1`;

    const response = await users.apiClient.get(url, { userName: name } as any);
    const val = response.data;

    const targetTs = val.summary.updateStats.minTimestamp;
    const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));

    const [dailyScoresPda] = PublicKey.findProgramAddressSync(
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

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000
    });

    const strategy1: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        { single: { index: 0, predicate: { threshold: 0, comparison: { greaterThan: {} } } } },
      ]
    };

    try {
      console.log(`[${name}] Executing 1-stat0 discrete validation`);

      const ix1 = buildInstruction(
        "validateStatV2",
        { payload, strategy: strategy1 },
        { dailyScoresMerkleRoots: dailyScoresPda },
        program.programId
      );

      const tx1 = new Transaction()
        .add(computeBudgetIx)
        .add(ix1);

      tx1.feePayer = user.user.publicKey;

      try {
        const sig = await sendAndConfirmTransaction(connection, tx1, [user.user]);
        console.log(`[${name}] stat-1 validation passed, signature: ${sig}`);
      } catch (err) {
        console.log(`[${name}] stat-1 validation rejected:`, err);
      }

    } catch (err) {
      console.error(`[${name}] V2 validation setup failed:`, err);
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

main().then(() => process.exit(0));
