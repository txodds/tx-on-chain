// Validate stat V4 for scores record targeting devnet
// Direct fixture booking with TXLINE, data access, and stat validation V4

// Run from the project root using this command
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/V1_stat_validation_v4.ts

import TxoracleJson from "../idl/txoracle.json";
import * as users from '../common/users';
import * as config from '../common/config';
import * as utils from '../common/utils';
import axios from "axios";
import { inspect } from 'util';
import { createHash } from "crypto";
import { EventSource } from 'eventsource';
import {
  address,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getStructEncoder,
  getU32Encoder,
  getU16Encoder,
  getU8Encoder,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  getSignatureFromTransaction,
} from "@solana/kit";
import { Ed25519Program } from "@solana/web3.js";

// Construct Ed25519 instruction using web3 helper
function createEd25519Ix(
  publicKey: ReadonlyUint8Array,
  message: ReadonlyUint8Array,
  signature: ReadonlyUint8Array
): Instruction {
  const ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: Buffer.from(publicKey),
    message: Buffer.from(message),
    signature: Buffer.from(signature),
  });

  // Map to Solana kit instruction format
  return {
    programAddress: address(ix.programId.toBase58()),
    data: new Uint8Array(ix.data),
  };
}

// Set up dynamic encoders for polymorphic validation payload
const statValidationPayloadEncoder = utils.createIdlEncoder(TxoracleJson, "statValidationPayload");
const fixtureForTreeValidationInputEncoder = utils.createIdlEncoder(TxoracleJson, "fixtureForTreeValidationInput");
const nDimensionalStrategyEncoder = utils.createIdlEncoder(TxoracleJson, "nDimensionalStrategy");
const bookFixturePayloadEncoder = utils.createIdlEncoder(TxoracleJson, "bookFixturePayload");

// Define instruction argument encoders
const validateFixtureForTreeArgsEncoder = getStructEncoder([
  ['payload', fixtureForTreeValidationInputEncoder]
]);

const validateStatV4ArgsEncoder = getStructEncoder([
  ['workerId', getU16Encoder()],
  ['payload', statValidationPayloadEncoder],
  ['strategy', nDimensionalStrategyEncoder]
]);

const closeWorkerTicketArgsEncoder = getStructEncoder([
  ['domain', getU8Encoder()],
  ['workerId', getU16Encoder()]
]);

const bookFixtureArgsEncoder = getStructEncoder([
  ['payload', bookFixturePayloadEncoder]
]);

// Instantiate reusable encoders and decoders
const utf8Encoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const base64Decoder = getBase64Decoder();
const base64Encoder = getBase64Encoder();

// Precompute instruction discriminators
function getDiscriminator(name: string): Uint8Array {
  return createHash("sha256").update(name).digest().subarray(0, 8);
}

const BOOK_DISCRIMINATOR = getDiscriminator("global:book_fixture");
const VALIDATE_FIXTURE_DISCRIMINATOR = getDiscriminator("global:validate_fixture_for_tree");
const VALIDATE_V4_DISCRIMINATOR = getDiscriminator("global:validate_stat_v4");
const CLOSE_WORKER_DISCRIMINATOR = getDiscriminator("global:close_worker_ticket");

// Define program constants
const SYSVAR_INSTRUCTIONS_PUBKEY = address("Sysvar1nstructions1111111111111111111111111");
const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

const BACKEND_ADMIN_PUBKEY = address(
  (TxoracleJson as any).constants?.find((c: any) => c.name === "BACKEND_ADMIN_PUBKEY")?.value ??
  "4nKMUKBLC3Th2dkFi3WFSoQc2xBCTLrmPFUmtauE8RMc"
);

export type NDimensionalStrategy = any;

// Compute ATA address natively
async function getAtaAddress(wallet: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addressEncoder.encode(wallet),
      addressEncoder.encode(TOKEN_2022_PROGRAM_ID),
      addressEncoder.encode(mint)
    ]
  });
  return ata;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");

  // Initialize network clients
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL");
  const programId = address(programIdString);

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set");
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

  console.log("API Token:", users.authState.apiToken);

  try {
    const targetFixtureId = 18228636; // 18146826;
    const targetSeq = 300;

    // Configure stat domain and static worker identifier
    const statDomain = 1;
    const workerId = 1;

    const domainBuffer = new Uint8Array([statDomain]);
    const workerIdBuffer = new Uint8Array(2);
    new DataView(workerIdBuffer.buffer).setUint16(0, workerId, true);

    // Derive reusable program addresses
    const [tokenTreasuryPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [utf8Encoder.encode("token_treasury_v2")]
    });

    // Derive fixture ticket PDA using four-byte fixture identifier
    const fixtureIdBytes = getU32Encoder().encode(targetFixtureId);

    const [fixtureTicketPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        utf8Encoder.encode("fixture_ticket"),
        addressEncoder.encode(user.user.address),
        fixtureIdBytes
      ]
    });

    // Derive stat worker ticket PDA
    const [statWorkerTicketPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        utf8Encoder.encode("worker_ticket"),
        addressEncoder.encode(user.user.address),
        domainBuffer,
        workerIdBuffer
      ]
    });

    const userTokenAccount = await getAtaAddress(user.user.address, tokenMint);
    const tokenTreasuryVault = await getAtaAddress(tokenTreasuryPda, tokenMint);

    // Verify whether fixture ticket already exists on-chain before booking
    const { value: existingFixtureTicket } = await rpc.getAccountInfo(fixtureTicketPda).send();

    if (!existingFixtureTicket) {
      console.log(`\n[${name}] Fetching quote for fixture ${targetFixtureId}...`);
      const quoteUrl = `/quotes/book-fixture?fixtureId=${targetFixtureId}&pubkey=${user.user.address}`;
      const quoteRes = await users.apiClient.get(quoteUrl, { userName: name } as any);
      const quoteResponse = quoteRes.data;

      const mappedQuotePayload = utils.formatPayloadToIdl(TxoracleJson, "bookFixturePayload", {
        user: address(quoteResponse.payload.user),
        fixtureId: quoteResponse.payload.fixtureId,
        price: typeof quoteResponse.payload.price === "bigint" ? quoteResponse.payload.price : BigInt(quoteResponse.payload.price),
        ts: BigInt(quoteResponse.payload.ts),
        validity: BigInt(quoteResponse.payload.validity),
      });

      // Encode quote signature and payload hash
      const serializedQuotePayload = bookFixturePayloadEncoder.encode(mappedQuotePayload);
      const quotePayloadHash = createHash('sha256').update(new Uint8Array(serializedQuotePayload)).digest();
      const quoteSignatureBuffer = base64Encoder.encode(quoteResponse.signature);

      const bookEd25519Ix = createEd25519Ix(
        addressEncoder.encode(BACKEND_ADMIN_PUBKEY),
        quotePayloadHash,
        quoteSignatureBuffer
      );

      const bookArgsData = bookFixtureArgsEncoder.encode({ payload: mappedQuotePayload });
      const bookData = new Uint8Array(8 + bookArgsData.length);
      bookData.set(BOOK_DISCRIMINATOR, 0);
      bookData.set(bookArgsData, 8);

      const bookFixtureInstruction: Instruction = {
        programAddress: programId,
        accounts: [
          { address: user.user.address, role: AccountRole.WRITABLE_SIGNER },
          { address: fixtureTicketPda, role: AccountRole.WRITABLE },
          { address: tokenMint, role: AccountRole.READONLY },
          { address: userTokenAccount, role: AccountRole.WRITABLE },
          { address: tokenTreasuryVault, role: AccountRole.WRITABLE },
          { address: tokenTreasuryPda, role: AccountRole.READONLY },
          { address: SYSVAR_INSTRUCTIONS_PUBKEY, role: AccountRole.READONLY },
          { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
          { address: ASSOCIATED_TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
        ],
        data: bookData
      };

      console.log(`[${name}] Submitting fixture booking transaction...`);
      const { value: bookBlockhash } = await rpc.getLatestBlockhash().send();

      const bookTxMessage = pipe(
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayerSigner(user.user, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(bookBlockhash, m),
        (m) => appendTransactionMessageInstructions([bookEd25519Ix, bookFixtureInstruction], m)
      );

      const signedBookTx = await signTransactionMessageWithSigners(bookTxMessage);
      assertIsTransactionWithBlockhashLifetime(signedBookTx);
      const bookTxSig = getSignatureFromTransaction(signedBookTx);
      await sendAndConfirm(signedBookTx, { commitment: 'confirmed' });
      console.log(`[${name}] Successfully booked fixture ${targetFixtureId} for ${quoteResponse.payload.price} raw TXLINE (TX: ${bookTxSig})`);

      await sleep(2000);
    } else {
      console.log(`[${name}] Fixture ${targetFixtureId} already booked on-chain, reusing existing ticket`);
    }

    // Fetch scores snapshot helper
    async function getScoresSnapshot(fixtureId: number, asOf?: number, retries = 5) {
      const url = asOf
        ? `/scores/snapshot/${fixtureId}?asOf=${asOf}`
        : `/scores/snapshot/${fixtureId}`;

      for (let i = 0; i < retries; i++) {
        try {
          const response = await users.apiClient.get(url);
          console.log(`\nSnapshot for fixture ${fixtureId}:`, response.data);
          return response.data;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 403 && i < retries - 1) {
            console.log(`[${name}] Backend indexer syncing ticket... retrying in 2s (Attempt ${i + 1}/${retries})`);
            await sleep(2000);
            continue;
          }
          console.error(`Failed to retrieve scores snapshot for ${fixtureId}:`, error);
          throw error;
        }
      }
    }

    await getScoresSnapshot(targetFixtureId, Date.now());

    let sampleScores: any = null;

    const scanRecentScores = async (fixtureId?: number) => {
      const msPerInterval = 300000;
      const now = new Date();

      for (let i = 0; i < 24; i++) {
        const targetTime = new Date(now.getTime() - (i * msPerInterval));
        const epochDay = Math.floor(targetTime.getTime() / 86400000);
        const hourOfDay = targetTime.getUTCHours();
        const interval = Math.floor(targetTime.getUTCMinutes() / 5);

        let updateUrl = `/scores/updates/${epochDay}/${hourOfDay}/${interval}`;
        if (fixtureId) updateUrl += `?fixtureId=${fixtureId}`;

        try {
          const response = await users.apiClient.get(updateUrl);
          if (response.data.length > 0) {
            console.log(`Scores updates found for Epoch ${epochDay} Hour ${hourOfDay} Interval ${interval}:`, response.data);
            if (!sampleScores) {
              sampleScores = response.data[0];
              console.log(`Captured sample for validation: FixtureId ${sampleScores.FixtureId} @ Ts ${sampleScores.Ts}`);
            }
          }
        } catch (error) {
          if (axios.isAxiosError(error)) {
            console.error("Request failed:", error.response?.data || error.message);
          } else {
            console.error("Error:", error);
          }
          process.exit(1);
        }
      }
    };

    await scanRecentScores();

    // Define evaluation strategies
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
            index_a: 0,
            index_b: 1,
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
            index_a: 0,
            index_b: 1,
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
            index_a: 0,
            index_b: 1,
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

    console.log(`\n[${name}] Initiating V4 validations`);

    // Fetch multiproof validation payload
    const fetchV4Payload = async (keys: string) => {
      const url = `/scores/stat-validation-v4?fixtureId=${targetFixtureId}&seq=${targetSeq}&statKeys=${keys}`;
      const res = await users.apiClient.get(url, { userName: name } as any);
      const response = res.data;

      // Normalize hex or base64 hashes into number arrays
      const parseHash = (rawData: any): number[] => {
        if (typeof rawData === 'string') {
          const bytes = rawData.length === 64
            ? Buffer.from(rawData, 'hex')
            : base64Encoder.encode(rawData);
          return Array.from(new Uint8Array(bytes));
        }
        return Array.from(rawData);
      };

      // Normalize optional zero-mask buffer
      const parseMask = (rawData: any): number[] | null => {
        if (!rawData) return null;
        if (typeof rawData === 'string') {
          const bytes = rawData.length === 1024
            ? Buffer.from(rawData, 'hex')
            : Buffer.from(rawData, 'base64');
          return Array.from(new Uint8Array(bytes));
        }
        return Array.from(rawData);
      };

      const mapProofNode = (node: any) => ({
        hash: parseHash(node.hash),
        isRightSibling: node.isRightSibling
      });

      const mappedSummary = utils.formatPayloadToIdl(TxoracleJson, "batchSummary", {
        fixtureId: BigInt(response.payload.summary.fixtureId),
        updateStats: {
          updateCount: response.payload.summary.updateStats.updateCount,
          minTimestamp: BigInt(response.payload.summary.updateStats.minTimestamp),
          maxTimestamp: BigInt(response.payload.summary.updateStats.maxTimestamp),
        },
        subTreeRoot: parseHash(
          response.payload.summary.eventStatsSubTreeRoot ||
          response.payload.summary.eventsSubTreeRoot ||
          response.payload.summary.subTreeRoot
        ),
      });

      const mappedMainTreeProof = response.payload.mainTreeProof.map(mapProofNode);

      // Detect whether backend produced V1 or V2 tree variant
      const isV2 = response.version === 'v2' || response.version === 2 ||
        response.payload.variant === 'v2' ||
        Boolean(response.payload.rawMask ?? response.payload.raw_mask) ||
        response.payload.leaves.some((leaf: any) => leaf.isZero !== undefined || leaf.is_zero !== undefined);

      const variantKey = isV2 ? "v2" : "v1";
      const variantData = isV2 ? {
        ts: BigInt(response.payload.ts),
        event_stat_root: parseHash(response.payload.eventStatRoot),
        fixture_proof: response.payload.fixtureProof.map(mapProofNode),
        leaves: response.payload.leaves.map((leaf: any) => ({
          stat: {
            key: leaf.stat.key,
            value: leaf.stat.value,
            period: leaf.stat.period
          },
          is_zero: Boolean(leaf.isZero ?? leaf.is_zero)
        })),
        multiproof_hashes: response.payload.multiproofHashes.map(mapProofNode),
        leaf_indices: response.payload.leafIndices,
        raw_mask: parseMask(response.payload.rawMask ?? response.payload.raw_mask)
      } : {
        ts: BigInt(response.payload.ts),
        event_stat_root: parseHash(response.payload.eventStatRoot),
        fixture_proof: response.payload.fixtureProof.map(mapProofNode),
        leaves: response.payload.leaves.map((leaf: any) => ({
          stat: {
            key: leaf.stat.key,
            value: leaf.stat.value,
            period: leaf.stat.period
          },
          stat_proof: (leaf.statProof || leaf.stat_proof || []).map(mapProofNode)
        })),
        multiproof_hashes: response.payload.multiproofHashes.map(mapProofNode),
        leaf_indices: response.payload.leafIndices
      };

      const mappedPayload = utils.formatPayloadToIdl(TxoracleJson, "statValidationPayload", {
        [variantKey]: variantData
      });

      return {
        ts: Number(response.payload.ts),
        summary: mappedSummary,
        mainTreeProof: mappedMainTreeProof,
        payload: mappedPayload,
        signature: typeof response.signature === 'string'
          ? base64Encoder.encode(response.signature)
          : new Uint8Array(response.signature)
      };
    };

    const payloadV4_2Leg = await fetchV4Payload("1002,1007");
    console.log(`[${name}] payload:`, inspect(payloadV4_2Leg, { depth: null, colors: true }));

    const payloadV4_3Leg = await fetchV4Payload("1002,1007,2007");
    const payloadV4_4Leg = await fetchV4Payload("1002,1007,2007,1");
    console.log(`[${name}] payload:`, inspect(payloadV4_4Leg, { depth: null, colors: true }));

    // Derive daily scores PDA matching V4 timestamp
    const v4EpochDay = Math.floor(payloadV4_2Leg.ts / (24 * 60 * 60 * 1000));
    const v4EpochDayBuffer = new Uint8Array(2);
    new DataView(v4EpochDayBuffer.buffer).setUint16(0, v4EpochDay, true);

    const [v4DailyScoresRootsPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [utf8Encoder.encode("daily_scores_roots"), v4EpochDayBuffer]
    });

    // Initialize worker ticket memory once using fixture batch summary
    const mappedFixtureForTreePayload = utils.formatPayloadToIdl(TxoracleJson, "fixtureForTreeValidationInput", {
      ts: BigInt(payloadV4_2Leg.ts),
      domain: statDomain,
      workerId: workerId,
      summary: payloadV4_2Leg.summary,
      mainTreeProof: payloadV4_2Leg.mainTreeProof
    });

    const fixtureArgsData = validateFixtureForTreeArgsEncoder.encode({
      payload: mappedFixtureForTreePayload
    });
    const fixtureData = new Uint8Array(8 + fixtureArgsData.length);
    fixtureData.set(VALIDATE_FIXTURE_DISCRIMINATOR, 0);
    fixtureData.set(fixtureArgsData, 8);

    const validateFixtureInstruction: Instruction = {
      programAddress: programId,
      accounts: [
        { address: user.user.address, role: AccountRole.WRITABLE_SIGNER },
        { address: statWorkerTicketPda, role: AccountRole.WRITABLE },
        { address: v4DailyScoresRootsPda, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY }
      ],
      data: fixtureData
    };

    const { value: latestBlockhashTx1 } = await rpc.getLatestBlockhash().send();

    console.log("\n[Real-Time] Initializing worker ticket via generalized tree validation (V1)");
    const tx1Message = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayerSigner(user.user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhashTx1, m),
      (m) => setTransactionMessageComputeUnitLimit(1400000, m),
      (m) => setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, m),
      (m) => appendTransactionMessageInstruction(validateFixtureInstruction, m)
    );

    const signedTx1 = await signTransactionMessageWithSigners(tx1Message);
    assertIsTransactionWithBlockhashLifetime(signedTx1);
    const tx1Sig = getSignatureFromTransaction(signedTx1);

    try {
      await sendAndConfirm(signedTx1, { commitment: 'confirmed' });
      console.log(`[Real-Time] Initialized static stat validation ticket (TX: ${tx1Sig})`);
    } catch (err: any) {
      console.error("\n=== TX1 SIMULATION ERROR ===");
      const logs = err?.context?.logs || err?.cause?.context?.logs || err?.logs;
      if (logs) {
        console.error(logs.join("\n"));
      } else {
        console.dir(err, { depth: null, colors: true });
      }
      process.exit(1);
    }

    const { value: validateBlockhash } = await rpc.getLatestBlockhash().send();

    // await sleep(2000);

    const runV4 = async (v4Data: any, strategy: any, label: string) => {
      // Encode V4 validation hash
      const serializedPayload = statValidationPayloadEncoder.encode(v4Data.payload);
      const payloadHash = createHash('sha256').update(new Uint8Array(serializedPayload)).digest();
      const validateEd25519Ix = createEd25519Ix(
        addressEncoder.encode(BACKEND_ADMIN_PUBKEY),
        payloadHash,
        v4Data.signature
      );

      const v4ArgsData = validateStatV4ArgsEncoder.encode({
        workerId,
        payload: v4Data.payload,
        strategy: utils.formatPayloadToIdl(TxoracleJson, "nDimensionalStrategy", strategy)
      });

      const v4DataBuffer = new Uint8Array(8 + v4ArgsData.length);
      v4DataBuffer.set(VALIDATE_V4_DISCRIMINATOR, 0);
      v4DataBuffer.set(v4ArgsData, 8);

      // Supply read-only fixture ticket to permit parallel validations without account write locks
      const validateV4Instruction: Instruction = {
        programAddress: programId,
        accounts: [
          { address: user.user.address, role: AccountRole.WRITABLE_SIGNER },
          { address: statWorkerTicketPda, role: AccountRole.READONLY },
          { address: fixtureTicketPda, role: AccountRole.READONLY },
          { address: SYSVAR_INSTRUCTIONS_PUBKEY, role: AccountRole.READONLY }
        ],
        data: v4DataBuffer
      };

      const validateTxMessage = pipe(
        createTransactionMessage({ version: 1 }),
        (m) => setTransactionMessageFeePayerSigner(user.user, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(validateBlockhash, m),
        (m) => setTransactionMessageComputeUnitLimit(1400000, m),
        (m) => setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, m),
        (m) => appendTransactionMessageInstructions([validateEd25519Ix, validateV4Instruction], m)
      );

      const signedTx = await signTransactionMessageWithSigners(validateTxMessage);
      assertIsTransactionWithBlockhashLifetime(signedTx);
      const tx2Sig = getSignatureFromTransaction(signedTx);

      try {
        await sendAndConfirm(signedTx, { commitment: 'confirmed' });

        // Retrieve confirmed transaction metadata
        let tx: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          tx = await rpc.getTransaction(tx2Sig, {
            commitment: 'confirmed',
            encoding: 'json',
            maxSupportedTransactionVersion: 1,
          }).send();
          if (tx) break;
          // await sleep(500);
        }

        // Decode return data byte buffer
        let validationResult: boolean | null = null;
        const returnDataBase64 = tx?.meta?.returnData?.data?.[0];

        if (returnDataBase64) {
          validationResult = Buffer.from(returnDataBase64, 'base64')[0] === 1;
        } else if (tx?.meta?.logMessages) {
          // Parse program return log entry as fallback
          const prefix = `Program return: ${programId} `;
          const returnLog = tx.meta.logMessages.find((log: string) => log.startsWith(prefix));
          if (returnLog) {
            const rawBase64 = returnLog.slice(prefix.length).trim();
            validationResult = Buffer.from(rawBase64, 'base64')[0] === 1;
          }
        }

        console.log(`[${name}] V4 ${label}: executed and confirmed: result = ${validationResult} (TX: ${tx2Sig})`);
      } catch (e: any) {
        console.error(`\n=== TX2 SIMULATION ERROR (${label}) ===`);
        const logs = e?.context?.logs || e?.cause?.data?.logs || e?.cause?.context?.logs || e?.cause?.logs || e?.logs;
        if (logs) {
          console.error(logs.join("\n"));
        } else {
          console.error("Message:", e?.message || e?.cause?.message);
        }
      }

      // Pace sequential executions to prevent public RPC rate limiting
      await sleep(500);
    };

    await runV4(payloadV4_2Leg, strategy1To3Plus, "1:3+ discrete");

    await runV4(payloadV4_2Leg, strategyDraw, "Binary draw");

    await runV4(payloadV4_3Leg, strategy3Leg, "Combined 3-leg");

    await runV4(payloadV4_4Leg, strategy4Leg, "Combined 4-leg");

    await runV4(payloadV4_2Leg, strategyGeometric, "Geometric 2-leg");

    // Evaluate calibrated discrete strategy
    const winningDiscrete: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        { single: { index: 0, predicate: { threshold: 9, comparison: { equalTo: {} } } } },
        { single: { index: 1, predicate: { threshold: 2, comparison: { equalTo: {} } } } }
      ]
    };

    // Evaluate calibrated binary difference
    const winningBinaryDiff: NDimensionalStrategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          binary: {
            index_a: 0,
            index_b: 1,
            op: { subtract: {} },
            predicate: { threshold: 7, comparison: { equalTo: {} } }
          }
        }
      ]
    };

    // Evaluate calibrated geometric distance
    const winningGeometric: NDimensionalStrategy = {
      geometricTargets: [
        { statIndex: 0, prediction: 10 },
        { statIndex: 1, prediction: 2 }
      ],
      distancePredicate: { threshold: 3, comparison: { lessThan: {} } },
      discretePredicates: []
    };

    await runV4(payloadV4_2Leg, winningDiscrete, "Calibrated discrete (9 == 9 && 2 == 2)");
    await sleep(2000);

    await runV4(payloadV4_2Leg, winningBinaryDiff, "Calibrated binary diff (9 - 2 == 7)");
    await sleep(2000);

    await runV4(payloadV4_2Leg, winningGeometric, "Calibrated geometric (dist 1 < 3)");
    await sleep(2000);

    // Construct instruction to reclaim rent
    const closeArgsData = closeWorkerTicketArgsEncoder.encode({ domain: statDomain, workerId });
    const closeData = new Uint8Array(8 + closeArgsData.length);
    closeData.set(CLOSE_WORKER_DISCRIMINATOR, 0);
    closeData.set(closeArgsData, 8);

    const closeWorkerInstruction: Instruction = {
      programAddress: programId,
      accounts: [
        { address: user.user.address, role: AccountRole.WRITABLE_SIGNER },
        { address: statWorkerTicketPda, role: AccountRole.WRITABLE }
      ],
      data: closeData
    };

    console.log("\n[Real-Time] Closing worker ticket to reclaim rent");
    const { value: latestBlockhashClose } = await rpc.getLatestBlockhash().send();
    const tx3Message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(user.user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhashClose, m),
      (m) => appendTransactionMessageInstruction(closeWorkerInstruction, m)
    );

    const signedTx3 = await signTransactionMessageWithSigners(tx3Message);
    assertIsTransactionWithBlockhashLifetime(signedTx3);
    const tx3Sig = getSignatureFromTransaction(signedTx3);
    await sendAndConfirm(signedTx3, { commitment: 'confirmed' });
    console.log(`[Real-Time] Worker ticket closed and rent reclaimed (TX: ${tx3Sig})`);

    await getScoresSnapshot(targetFixtureId, Date.now());

    async function listenToScoresStream(streamId: string): Promise<void> {
      const CLOSED_STATE = 2;
      let isReconnecting = false;
      let lastSeenId: string | undefined = undefined;

      function connect() {
        console.log(`[Scores - ${streamId}] Subscribing to all scores updates...`);
        const streamUrl = `${config.API_BASE_URL}/scores/stream`;

        const eventSource = new EventSource(streamUrl, {
          fetch: async (input, init) => {
            const attemptFetch = (token: string) => {
              const customHeaders: Record<string, string> = {
                ...(init?.headers as Record<string, string>),
                'Accept-Encoding': 'deflate',
                'Authorization': `Bearer ${token}`,
                'X-Api-Token': users.authState.apiToken,
              };

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
              console.log(`[Scores - ${streamId}] SSE connection rejected Renewing JWT...`);
              const newJwt = await users.renewJwt();
              response = await attemptFetch(newJwt);
            }

            return response;
          },
        });

        eventSource.onmessage = (event) => {
          if (event.lastEventId) {
            lastSeenId = event.lastEventId;
          }
          console.log(`[Scores - ${streamId}] Received payload:`, event.data);
        };

        eventSource.onopen = () => {
          console.log(`[Scores - ${streamId}] Stream connection opened`);
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

    listenToScoresStream("1");

    const waitDuration = 3601 * 1000;
    console.log(`Waiting for ${waitDuration / 1000} seconds for scores to go through...`);
    await new Promise(resolve => setTimeout(resolve, waitDuration));

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