// Demo stat validaton V2 and V3 for comparison for a game_finalised record

// Run with
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="./_keys/testuser-wallet-1.json" ts-node examples/devnet/scripts/subscription_scores_v3c.ts

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as users from '../common/users';
import axios from "axios";
import { PublicKey } from "@solana/web3.js";
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
    []
  );
  console.log("API Token:", users.authState.apiToken);
 
  // Upgrade the provider to use the real, funded Trader wallet
  const userWallet = new anchor.Wallet(user.user);
  const userProvider = new anchor.AnchorProvider(connection, userWallet, anchor.AnchorProvider.defaultOptions());
  
  // Create a new program instance permanently bound to Trader A
  const userProgram = new anchor.Program(program.idl, userProvider);

  try {
    // Map API proof array to exact shape Anchor expects
    const mapProof = (proofArray: ApiProofNode[] | undefined): ProofNode[] => {
      if (!proofArray) return [];
      return proofArray.map(n => ({
        hash: Array.from(n.hash),
        isRightSibling: n.isRightSibling
      }));
    };

    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 1_400_000 
    });

    // Define unified strategies
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
            predicate: { threshold: 0, comparison: { equalTo: {} } }
          }
        }
      ]
    };

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
    };

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
    };

    const strategyGeometric: NDimensionalStrategy = {
      geometricTargets: [
        { statIndex: 0, prediction: 0 }, 
        { statIndex: 1, prediction: 1 }
      ],
      distancePredicate: { threshold: 2, comparison: { lessThan: {} } },
      discretePredicates: []
    };

    // Execute V2 legacy validations
    console.log(`\n[${name}] Initiating V2 validations`);

    const urlV2 = `/scores/stat-validation?fixtureId=18218149&seq=1087&statKeys=1002,1007,2007,1`;
    const resV2 = await users.apiClient.get(urlV2, { userName: name } as any);
    const valV2 = resV2.data;

    const targetTs = valV2.summary.updateStats.minTimestamp;
    const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));
    const [dailyScoresPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), new BN(epochDay).toBuffer("le", 2)],
      program.programId
    );

    const payloadV2: StatValidationInput = {
      ts: new BN(targetTs),
      fixtureSummary: {
        fixtureId: new BN(valV2.summary.fixtureId),
        updateStats: {
          updateCount: valV2.summary.updateStats.updateCount,
          minTimestamp: new BN(valV2.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(valV2.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: Array.from(valV2.summary.eventStatsSubTreeRoot),
      },
      fixtureProof: mapProof(valV2.subTreeProof),
      mainTreeProof: mapProof(valV2.mainTreeProof),
      eventStatRoot: Array.from(valV2.eventStatRoot), 
      stats: valV2.statsToProve.map((statObj: any, index: number) => ({
        stat: statObj,
        statProof: mapProof(valV2.statProofs[index])
      }))
    };

    const payloadV2_2Leg = { ...payloadV2, stats: payloadV2.stats.slice(0, 2) };
    const payloadV2_3Leg = { ...payloadV2, stats: payloadV2.stats.slice(0, 3) };

    const runV2 = async (payload: any, strategy: any, label: string) => {
      const isValid = await userProgram.methods
        .validateStatV2(payload, strategy)
        .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
        .preInstructions([computeBudgetIx])
        .view();
      console.log(`[${name}] V2 ${label}: ${isValid ? 'passed' : 'rejected'}`);
    };

    await runV2(payloadV2_2Leg, strategy1To3Plus, "1:3+ discrete");
    await runV2(payloadV2_2Leg, strategyDraw, "Binary draw");
    await runV2(payloadV2_3Leg, strategy3Leg, "Combined 3-leg");
    await runV2(payloadV2, strategy4Leg, "Combined 4-leg");
    await runV2(payloadV2_2Leg, strategyGeometric, "Geometric 2-leg");

    // Execute V3 multiproof validations
    console.log(`\n[${name}] Initiating V3 validations`);

    const fetchV3Payload = async (keys: string) => {
      const url = `/scores/stat-validation-v3?fixtureId=18218149&seq=1087&statKeys=${keys}`;
      const res = await users.apiClient.get(url, { userName: name } as any);
      const val = res.data;

      const parseHash = (h: any) => {
        const rawData = h.hash ? h.hash : h; 
        if (typeof rawData === 'string') {
          const buf = rawData.length === 64 ? Buffer.from(rawData, 'hex') : Buffer.from(rawData, 'base64');
          return Array.from(buf);
        }
        return Array.from(rawData);
      };

      const mapProof = (proof: any[]) => proof.map(p => ({
        hash: parseHash(p),
        isRightSibling: p.isRightSibling || false
      }));

      return {
        ts: new BN(targetTs),
        fixtureSummary: {
          fixtureId: new BN(val.summary.fixtureId),
          updateStats: {
            updateCount: val.summary.updateStats.updateCount,
            minTimestamp: new BN(val.summary.updateStats.minTimestamp),
            maxTimestamp: new BN(val.summary.updateStats.maxTimestamp),
          },
          eventsSubTreeRoot: parseHash(val.summary.eventStatsSubTreeRoot),
        },
        fixtureProof: mapProof(val.subTreeProof),
        mainTreeProof: mapProof(val.mainTreeProof),
        eventStatRoot: parseHash(val.eventStatRoot), 
        leaves: val.statsToProve.map((l: any) => ({
          stat: l.stat,
          statProof: mapProof(l.statProof)
        })),
        leafIndices: val.multiproof.indices,
        multiproofHashes: mapProof(val.multiproof.hashes)
      };
    };

    const runV3 = async (payload: any, strategy: any, label: string) => {
      const isValid = await userProgram.methods
        .validateStatV3(payload, strategy)
        .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
        .preInstructions([computeBudgetIx])
        .view();
      console.log(`[${name}] V3 ${label}: ${isValid ? 'passed' : 'rejected'}`);
    };

    // Fetch dedicated multiproof payloads mapped to strategy leg counts
    const payloadV3_2Leg = await fetchV3Payload("1002,1007");

    const inspectedPayload_2Leg = inspect(payloadV3_2Leg, { depth: null, colors: true });
    const payloadPrefix_2Leg = `[${name}] payload:`;
    console.log(payloadPrefix_2Leg, inspectedPayload_2Leg);

    const payloadV3_3Leg = await fetchV3Payload("1002,1007,2007");
    const payloadV3_4Leg = await fetchV3Payload("1002,1007,2007,1");

    const inspectedPayload_4Leg = inspect(payloadV3_4Leg, { depth: null, colors: true });
    const payloadPrefix_4Leg = `[${name}] payload:`;
    console.log(payloadPrefix_4Leg, inspectedPayload_4Leg);

    await runV3(payloadV3_2Leg, strategy1To3Plus, "1:3+ discrete");
    await runV3(payloadV3_2Leg, strategyDraw, "Binary draw");
    await runV3(payloadV3_3Leg, strategy3Leg, "Combined 3-leg");
    await runV3(payloadV3_4Leg, strategy4Leg, "Combined 4-leg");
    await runV3(payloadV3_2Leg, strategyGeometric, "Geometric 2-leg");

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
