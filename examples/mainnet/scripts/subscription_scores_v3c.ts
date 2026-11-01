// Demo stat validaton V2 and V3 for comparison for a game_finalised record

// Run with
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="mainnet/keys/testuser-wallet.json" ts-node mainnet/scripts/subscription_scores_v3c.ts

import TxoracleJson from "../idl/txoracle.json";
import * as users from '../common/users';
import * as utils from '../common/utils';
import axios from "axios";
import { inspect } from 'util';
import { createHash } from "crypto";
import {
  address,
  createSolanaRpc,
  getProgramDerivedAddress,
  getUtf8Encoder,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getStructEncoder,
} from "@solana/kit";

// Setup dynamic encoders from IDL
const statValidationInputEncoder = utils.createIdlEncoder(TxoracleJson, "statValidationInput");
const statValidationInputV3Encoder = utils.createIdlEncoder(TxoracleJson, "statValidationInputV3");
const nDimensionalStrategyEncoder = utils.createIdlEncoder(TxoracleJson, "nDimensionalStrategy");

const validateStatV2ArgsEncoder = getStructEncoder([
  ['payload', statValidationInputEncoder],
  ['strategy', nDimensionalStrategyEncoder]
]);

const validateStatV3ArgsEncoder = getStructEncoder([
  ['payload', statValidationInputV3Encoder],
  ['strategy', nDimensionalStrategyEncoder]
]);

// Relaxed types to replace Anchor's IdlTypes exports
export type NDimensionalStrategy = any;
export type StatValidationInput = any;
export type StatValidationInputV3 = any;

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com";
  const rpc = createSolanaRpc(rpcUrl);

  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL!");
  const programId = address(programIdString);

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  const tokenMint = address(mintAddress);

  console.log("Program ID:", programId);
  console.log("Token Mint:", tokenMint);

  const walletPath = process.env.ANCHOR_WALLET!;
  const name = "Trader A";
   
  const user = await users.setupUser(
    name,
    walletPath,
    tokenMint,
    rpc,
    programId,
    1,
    4,
    []
  );

  try {
    // Map API proof array to exact shape expected by IDL
    const mapProof = (proof: any[]): { hash: number[]; isRightSibling: boolean }[] => 
      proof.map(p => ({
        hash: Array.from(p.hash),
        isRightSibling: p.isRightSibling
      }));

    // Manually construct compute budget instruction
    const computeData = new Uint8Array(5);
    computeData[0] = 2; 
    new DataView(computeData.buffer).setUint32(1, 1400000, true);
    
    const computeBudgetIx = {
      programAddress: address("ComputeBudget111111111111111111111111111111"),
      accounts: [],
      data: computeData
    };

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

    // England v Argentina: July 15, 2026
    const fixtureId = 18241006;
    const seq = 962;

    // Execute V2 legacy validations
    console.log(`\n[${name}] Initiating V2 validations`);

    const urlV2 = `/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKeys=1002,1007,2007,1`;
    const resV2 = await users.apiClient.get(urlV2, { userName: name } as any);
    const valV2 = resV2.data;

    const targetTs = valV2.summary.updateStats.minTimestamp;
    const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));
    
    const epochDayBuffer = new Uint8Array(2);
    new DataView(epochDayBuffer.buffer).setUint16(0, epochDay, true);

    const [dailyScoresPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        getUtf8Encoder().encode("daily_scores_roots"),
        epochDayBuffer
      ]
    });

    const payloadV2: StatValidationInput = utils.formatPayloadToIdl(TxoracleJson, "statValidationInput", {
      ts: targetTs,
      fixtureSummary: {
        fixtureId: valV2.summary.fixtureId,
        updateStats: {
          updateCount: valV2.summary.updateStats.updateCount,
          minTimestamp: valV2.summary.updateStats.minTimestamp,
          maxTimestamp: valV2.summary.updateStats.maxTimestamp,
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
    });

    const payloadV2_2Leg = { ...payloadV2, stats: payloadV2.stats.slice(0, 2) };
    const payloadV2_3Leg = { ...payloadV2, stats: payloadV2.stats.slice(0, 3) };

    const runV2 = async (payload: StatValidationInput, strategy: NDimensionalStrategy, label: string) => {
      const discriminator = createHash("sha256").update("global:validate_stat_v2").digest().subarray(0, 8);
      const argsData = validateStatV2ArgsEncoder.encode({ payload, strategy: utils.formatPayloadToIdl(TxoracleJson, "nDimensionalStrategy", strategy) });

      const validateData = new Uint8Array(8 + argsData.length);
      validateData.set(discriminator, 0);
      validateData.set(argsData, 8);

      const validateInstruction = {
        programAddress: programId,
        accounts: [{ address: dailyScoresPda, role: AccountRole.READONLY }],
        data: validateData
      };

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const txMessage = pipe(
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayerSigner(user.user, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(computeBudgetIx, m),
        (m) => appendTransactionMessageInstruction(validateInstruction, m)
      );

      const signedTx = await signTransactionMessageWithSigners(txMessage);
      const wireTx = getBase64EncodedWireTransaction(signedTx);
      const simulation = await rpc.simulateTransaction(wireTx, { encoding: "base64" }).send();

      const isValid = !simulation.value.err;
      console.log(`[${name}] V2 ${label}: ${isValid ? 'passed' : 'rejected'}`);
      
      if (!isValid) {
        console.error(`Simulation Error for V2 ${label}:`, simulation.value.err);
      }
    };

    await runV2(payloadV2_2Leg, strategy1To3Plus, "1:3+ discrete");
    await runV2(payloadV2_2Leg, strategyDraw, "Binary draw");
    await runV2(payloadV2_3Leg, strategy3Leg, "Combined 3-leg");
    await runV2(payloadV2, strategy4Leg, "Combined 4-leg");
    await runV2(payloadV2_2Leg, strategyGeometric, "Geometric 2-leg");

    // Execute V3 multiproof validations
    console.log(`\n[${name}] Initiating V3 validations`);

    const fetchV3Payload = async (keys: string) => {
      const url = `/scores/stat-validation-v3?fixtureId=${fixtureId}&seq=${seq}&statKeys=${keys}`;
      const res = await users.apiClient.get(url, { userName: name } as any);
      const val = res.data;

      const payloadV3: StatValidationInputV3 = utils.formatPayloadToIdl(TxoracleJson, "statValidationInputV3", {
        ts: targetTs,
        fixtureSummary: {
          fixtureId: val.summary.fixtureId,
          updateStats: {
            updateCount: val.summary.updateStats.updateCount,
            minTimestamp: val.summary.updateStats.minTimestamp,
            maxTimestamp: val.summary.updateStats.maxTimestamp,
          },
          eventsSubTreeRoot: Array.from(val.summary.eventStatsSubTreeRoot),
        },
        fixtureProof: mapProof(val.subTreeProof),
        mainTreeProof: mapProof(val.mainTreeProof),
        eventStatRoot: Array.from(val.eventStatRoot), 
        leaves: val.statsToProve.map((l: any) => ({
          stat: l.stat,
          statProof: mapProof(l.statProof)
        })),
        leafIndices: val.multiproof.indices,
        multiproofHashes: mapProof(val.multiproof.hashes)
      });

      return payloadV3;
    };

    const runV3 = async (payload: StatValidationInputV3, strategy: NDimensionalStrategy, label: string) => {
      const discriminator = createHash("sha256").update("global:validate_stat_v3").digest().subarray(0, 8);
      const argsData = validateStatV3ArgsEncoder.encode({ payload, strategy: utils.formatPayloadToIdl(TxoracleJson, "nDimensionalStrategy", strategy) });

      const validateData = new Uint8Array(8 + argsData.length);
      validateData.set(discriminator, 0);
      validateData.set(argsData, 8);

      const validateInstruction = {
        programAddress: programId,
        accounts: [{ address: dailyScoresPda, role: AccountRole.READONLY }],
        data: validateData
      };

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const txMessage = pipe(
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayerSigner(user.user, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(computeBudgetIx, m),
        (m) => appendTransactionMessageInstruction(validateInstruction, m)
      );

      const signedTx = await signTransactionMessageWithSigners(txMessage);
      const wireTx = getBase64EncodedWireTransaction(signedTx);
      const simulation = await rpc.simulateTransaction(wireTx, { encoding: "base64" }).send();

      const isValid = !simulation.value.err;
      console.log(`[${name}] V3 ${label}: ${isValid ? 'passed' : 'rejected'}`);
      
      if (!isValid) {
        console.error(`Simulation Error for V3 ${label}:`, simulation.value.err);
      }
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