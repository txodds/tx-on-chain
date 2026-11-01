// Demonstrate fixture validation by simulation with view call

// Run from project root using this command and replace wallet location
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/fixture_validation_view_only.ts
import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
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
  getU32Encoder,
  getArrayEncoder,
} from "@solana/kit";
import * as utils from '../common/utils';

// Array wrapper manually since it is not a top level struct
const mapProofArray = (proofArray: any[]) => proofArray.map(p => 
  utils.formatPayloadToIdl(TxoracleJson, "proofNode", p)
);

// Load struct encoders dynamically from IDL
const fixtureEncoder = utils.createIdlEncoder(TxoracleJson, "fixture");
const summaryEncoder = utils.createIdlEncoder(TxoracleJson, "fixtureBatchSummary");
const proofNodeEncoder = utils.createIdlEncoder(TxoracleJson, "proofNode");

// Array wrapper manually since it is not a top-level struct
const proofEncoder = getArrayEncoder(proofNodeEncoder, { size: getU32Encoder() });

// Compose top-level instruction arguments encoder
const validateFixtureArgsEncoder = getStructEncoder([
  ['snapshot', fixtureEncoder],
  ['summary', summaryEncoder],
  ['subTreeProof', proofEncoder],
  ['mainTreeProof', proofEncoder]
]);

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
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
    [],
    undefined,
    undefined   
  );

  var sampleFixture: any = null;

  const scanLast12Hours = async (user: users.User) => {
    const MS_PER_HOUR = 3600000;
    const now = new Date();

    for (let i = 0; i < 12; i++) {
      const targetTime = new Date(now.getTime() - (i * MS_PER_HOUR));
      const epochDay = Math.floor(targetTime.getTime() / (24 * MS_PER_HOUR));     
      const hourOfDay = targetTime.getUTCHours();
      
      const updateUrl = `${config.API_BASE_URL}/fixtures/updates/${epochDay}/${hourOfDay}`;
      
      try {
        console.log(`Query fixture interval ${i}`);
        
        const response = await users.apiClient.get(updateUrl);
        
        if (response.data.length > 0) {
          console.log(`Fixtures updates found for Epoch ${epochDay} Hour ${hourOfDay}:`, response.data);
          
          // Capture first fixture to use for validation
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

  // Perform fixture snapshot validation view call
  if (sampleFixture) {
    const validationUrl = `${config.API_BASE_URL}/fixtures/validation?fixtureId=${sampleFixture.FixtureId}&timestamp=${sampleFixture.Ts}`;
    try {
      const vResponse = await users.apiClient.get(validationUrl);
      console.log("Validation proof response:", vResponse.data);
      const validation = vResponse.data;

      // Extract game state and pure identifier
      const packedId = validation.snapshot.FixtureId;
      const shiftDivisor = 281474976710656; 
      
      const pureFixtureId = packedId % shiftDivisor;
      const gameState = Math.floor(packedId / shiftDivisor);

      console.log(`Packed FixtureId: ${packedId}`);
      console.log(`Actual FixtureId: ${pureFixtureId}`);
      console.log(`Game State: ${gameState}`);

      const snapshot = utils.formatPayloadToIdl(TxoracleJson, "fixture", validation.snapshot);
      const summary = utils.formatPayloadToIdl(TxoracleJson, "fixtureBatchSummary", validation.summary);
      const subTreeProof = mapProofArray(validation.subTreeProof);
      const mainTreeProof = mapProofArray(validation.mainTreeProof);

      console.log("Preparing on-chain fixture validation view call...");

      // Derive daily fixtures roots PDA
      const tsMs = validation.snapshot.Ts;
      const epochDay = Math.floor(tsMs / (24 * 60 * 60 * 1000));
      const windowStartDay = Math.floor(epochDay / 10) * 10;

      // Convert window start day to little-endian buffer
      const windowStartBuffer = new Uint8Array(2);
      new DataView(windowStartBuffer.buffer).setUint16(0, windowStartDay, true);

      const [tenDailyFixturesRootsPda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [
          getUtf8Encoder().encode("ten_daily_fixtures_roots"),
          windowStartBuffer
        ]
      });

      console.log(`Targeting PDA: ${tenDailyFixturesRootsPda} for window start day: ${windowStartDay}`);

      // Manually construct compute budget instruction
      const computeData = new Uint8Array(5);
      computeData[0] = 2; 
      new DataView(computeData.buffer).setUint32(1, 1000000, true);
      
      const computeInstruction = {
        programAddress: address("ComputeBudget111111111111111111111111111111"),
        accounts: [],
        data: computeData
      };

      // Construct validate fixture instruction
      const discriminator = createHash("sha256").update("global:validate_fixture").digest().subarray(0, 8);
      const argsData = validateFixtureArgsEncoder.encode({
        snapshot,
        summary,
        subTreeProof,
        mainTreeProof
      });

      const validateData = new Uint8Array(8 + argsData.length);
      validateData.set(discriminator, 0);
      validateData.set(argsData, 8);

      const validateInstruction = {
        programAddress: programId,
        accounts: [
          { address: tenDailyFixturesRootsPda, role: AccountRole.READONLY }
        ],
        data: validateData
      };

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      // Build transaction for simulation
      const txMessage = pipe(
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayerSigner(user.user, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(computeInstruction, m),
        (m) => appendTransactionMessageInstruction(validateInstruction, m)
      );

      const signedTx = await signTransactionMessageWithSigners(txMessage);
      const wireTx = getBase64EncodedWireTransaction(signedTx);

      console.log("Executing view simulation to verify cryptographic proofs...");
      const simulation = await rpc.simulateTransaction(wireTx, { encoding: "base64" }).send();

      if (simulation.value.err) {
        console.error("Simulation Logs:", simulation.value.logs);
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
      }

      const unitsConsumed = simulation.value.unitsConsumed;

      if (typeof unitsConsumed !== 'bigint') {
        throw new Error("Simulation did not return units consumed");
      }

      console.log(`View simulation successful. Consumed CU: ${unitsConsumed}`);
      console.log("Fixture validation proof is cryptographically sound on-chain");

    } catch (vError) {
      console.error("Validation proof extraction failed:", vError);
    }
  }
}

main().then(() => process.exit(0));