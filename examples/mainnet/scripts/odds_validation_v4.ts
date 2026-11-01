// Demonstrate credit purchasing, fixture booking, and odds validation V4 targeting service level

// Run script
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="mainnet/keys/testuser-wallet.json" ts-node mainnet/scripts/odds_validation_v4.ts

import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import * as utils from '../common/utils';
import axios from "axios";
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

// Set up dynamic encoders from IDL
const fixtureForTreeValidationInputEncoder = utils.createIdlEncoder(TxoracleJson, "fixtureForTreeValidationInput");
const oddsValidationInputV4Encoder = utils.createIdlEncoder(TxoracleJson, "oddsValidationInputV4");
const oddsEncoder = utils.createIdlEncoder(TxoracleJson, "odds");
const bookFixturePayloadEncoder = utils.createIdlEncoder(TxoracleJson, "bookFixturePayload");

// Set up instruction argument encoders
const validateFixtureForTreeArgsEncoder = getStructEncoder([['payload', fixtureForTreeValidationInputEncoder]]);
const validateOddsV4ArgsEncoder = getStructEncoder([
  ['workerId', getU16Encoder()],
  ['payload', oddsValidationInputV4Encoder]
]);
const bookFixtureArgsEncoder = getStructEncoder([['payload', bookFixturePayloadEncoder]]);
const purchaseCreditsArgsEncoder = getStructEncoder([['units', getU32Encoder()]]);
const closeWorkerTicketArgsEncoder = getStructEncoder([
  ['domain', getU8Encoder()],
  ['workerId', getU16Encoder()]
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

const PURCHASE_DISCRIMINATOR = getDiscriminator("global:purchase_validation_credits");
const BOOK_DISCRIMINATOR = getDiscriminator("global:book_fixture");
const VALIDATE_FIXTURE_DISCRIMINATOR = getDiscriminator("global:validate_fixture_for_tree");
const VALIDATE_ODDS_DISCRIMINATOR = getDiscriminator("global:validate_odds_v4");
const CLOSE_WORKER_DISCRIMINATOR = getDiscriminator("global:close_worker_ticket");

export interface ApiProofNode {
  hash: number[] | Buffer | Uint8Array
  isRightSibling: boolean
}

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
  oddsLeafHash?: number[]
  oddsSnapshot: ApiOdds
  summary: ApiOddsBatchSummary
  subTreeProof: ApiProofNode[]
  mainTreeProof: ApiProofNode[]
}

export interface ApiOddsValidationResponseV4 {
  payload: ApiOddsValidationInputV4
  signature: string
}

// Define program constants
const SYSVAR_INSTRUCTIONS_PUBKEY = address("Sysvar1nstructions1111111111111111111111111");
const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const ED25519_PROGRAM_ID = address("Ed25519SigVerify111111111111111111111111111");

// Extract backend admin pubkey dynamically from IDL constants
const BACKEND_ADMIN_PUBKEY = address(
  (TxoracleJson as any).constants?.find((c: any) => c.name === "BACKEND_ADMIN_PUBKEY")?.value ??
  "4nKMUKBLC3Th2dkFi3WFSoQc2xBCTLrmPFUmtauE8RMc"
);

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

// Throttle sequential transaction confirmations to satisfy public RPC rate limits
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com";
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

  const authority = user.user;
  console.log("API Token:", users.authState.apiToken);

  // Scan recent intervals to locate finalized odds updates
  const intervalMs = 5 * 60 * 1000;
  const now = Date.now();
  const currentIntervalStart = Math.floor(now / intervalMs) * intervalMs;

  let v4Data: ApiOddsValidationResponseV4 | null = null;
  let payload: ApiOddsValidationInputV4 | null = null;

  // Scan historical buckets starting two intervals ago to guarantee Merkle finality
  for (let i = 2; i < 48; i++) {
    const targetIntervalTime = currentIntervalStart - (i * intervalMs);
    const targetDate = new Date(targetIntervalTime);
    const epochDay = Math.floor(targetIntervalTime / (24 * 60 * 60 * 1000));
    const hourOfDay = targetDate.getUTCHours();
    const interval = Math.floor(targetDate.getUTCMinutes() / 5);

    try {
      const updatesResponse = await users.apiClient.get(`/odds/updates/${epochDay}/${hourOfDay}/${interval}`);
      const updates = updatesResponse.data;

      if (!updates || updates.length === 0) continue;

      const finalizedCandidates = [...updates].reverse();

      for (const sampleOdds of finalizedCandidates) {
        const targetMessageId = sampleOdds.MessageId || sampleOdds.messageId;
        const targetTimestamp = Number(sampleOdds.Ts || sampleOdds.ts);
        const targetFixtureId = sampleOdds.FixtureId || sampleOdds.fixtureId;

        try {
          const vResponse = await users.apiClient.get<ApiOddsValidationResponseV4>(
            `/odds/validation-v4`,
            { params: { messageId: targetMessageId, ts: targetTimestamp } }
          );

          v4Data = vResponse.data;
          payload = v4Data.payload;

          const snapshot = payload.oddsSnapshot;

          console.log(`Discovered valid target -> Fixture: ${targetFixtureId} | MessageId: ${targetMessageId} | Ts: ${targetTimestamp}`);
          console.log(`\n=== Target Odds Snapshot ===`);
          console.log(`Bookmaker: ${snapshot.Bookmaker} (ID: ${snapshot.BookmakerId})`);
          console.log(`Market: ${snapshot.SuperOddsType}`);
          console.log(`Live: ${snapshot.InRunning ? "Yes" : "No"}`);

          if (snapshot.MarketPeriod) {
            console.log(`Period: ${snapshot.MarketPeriod}`);
          }

          if (snapshot.MarketParameters) {
            console.log(`Params: ${snapshot.MarketParameters}`);
          }

          console.log(`Selections:`);
          snapshot.PriceNames.forEach((priceName: string, idx: number) => {
            console.log(`  * ${priceName}: ${snapshot.Prices[idx]}`);
          });
          console.log(`============================\n`);

          break;
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404) continue;
          throw err;
        }
      }

      if (payload) break;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) continue;
      throw err;
    }
  }

  if (!payload || !v4Data) {
    throw new Error("Could not find any finalized odds validation proofs in scanned intervals");
  }

  // Bind narrowed non-null references for downstream nested scopes
  const targetPayload = payload;
  const targetV4Data = v4Data;

  const fixtureIdToBook = Number(targetPayload.oddsSnapshot.FixtureId);

  // Derive program addresses
  const [userValidationStatePda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8Encoder.encode("user_state"), addressEncoder.encode(authority.address)]
  });

  const [tokenTreasuryPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8Encoder.encode("token_treasury_v2")]
  });

  const userTokenAccount = await getAtaAddress(authority.address, tokenMint);
  const tokenTreasuryVault = await getAtaAddress(tokenTreasuryPda, tokenMint);

  // Purchase validation credits to cover fixture booking and odds validation
  console.log(`\n[${name}] Purchasing validation credits...`);
  const unitsToPurchase = 10;

  const purchaseArgsData = purchaseCreditsArgsEncoder.encode({ units: unitsToPurchase });
  const purchaseData = new Uint8Array(8 + purchaseArgsData.length);
  purchaseData.set(PURCHASE_DISCRIMINATOR, 0);
  purchaseData.set(purchaseArgsData, 8);

  const purchaseInstruction: Instruction = {
    programAddress: programId,
    accounts: [
      { address: authority.address, role: AccountRole.WRITABLE_SIGNER },
      { address: userValidationStatePda, role: AccountRole.WRITABLE },
      { address: tokenMint, role: AccountRole.READONLY },
      { address: userTokenAccount, role: AccountRole.WRITABLE },
      { address: tokenTreasuryVault, role: AccountRole.WRITABLE },
      { address: tokenTreasuryPda, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: purchaseData
  };

  let { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const purchaseTxMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(purchaseInstruction, m)
  );

  let signedTx = await signTransactionMessageWithSigners(purchaseTxMessage);
  assertIsTransactionWithBlockhashLifetime(signedTx);
  const purchaseTxSig = getSignatureFromTransaction(signedTx);
  await sendAndConfirm(signedTx, { commitment: 'confirmed' });
  console.log(`[${name}] Purchased ${unitsToPurchase} credits (TX: ${purchaseTxSig})`);

  await sleep(2000);

  // Book fixture for odds validation
  console.log(`\n[${name}] Fetching quote for fixture ${fixtureIdToBook}...`);
  const quoteUrl = `/quotes/book-fixture?fixtureId=${fixtureIdToBook}&pubkey=${authority.address}`;
  const res = await users.apiClient.get(quoteUrl, { userName: name } as any);
  const quoteResponse = res.data;

  const mappedQuotePayload = utils.formatPayloadToIdl(TxoracleJson, "bookFixturePayload", {
    user: address(quoteResponse.payload.user),
    fixtureId: quoteResponse.payload.fixtureId,
    price: quoteResponse.payload.price,
    ts: quoteResponse.payload.ts,
    validity: quoteResponse.payload.validity
  });

  const serializedQuotePayload = bookFixturePayloadEncoder.encode(mappedQuotePayload);
  const quotePayloadHash = createHash('sha256').update(new Uint8Array(serializedQuotePayload)).digest();
  const quoteSignatureBuffer = base64Encoder.encode(quoteResponse.signature);

  const bookEd25519Ix = createEd25519Ix(
    addressEncoder.encode(BACKEND_ADMIN_PUBKEY),
    quotePayloadHash,
    quoteSignatureBuffer
  );

  // Derive fixture ticket PDA using 4-byte fixture identifier
  const fixtureIdBytes = getU32Encoder().encode(fixtureIdToBook);

  const [fixtureTicketPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      utf8Encoder.encode("fixture_ticket"),
      addressEncoder.encode(authority.address),
      fixtureIdBytes
    ]
  });

  const bookArgsData = bookFixtureArgsEncoder.encode({ payload: mappedQuotePayload });
  const bookData = new Uint8Array(8 + bookArgsData.length);
  bookData.set(BOOK_DISCRIMINATOR, 0);
  bookData.set(bookArgsData, 8);

  const bookFixtureInstruction: Instruction = {
    programAddress: programId,
    accounts: [
      { address: authority.address, role: AccountRole.WRITABLE_SIGNER },
      { address: userValidationStatePda, role: AccountRole.WRITABLE },
      { address: fixtureTicketPda, role: AccountRole.WRITABLE },
      { address: SYSVAR_INSTRUCTIONS_PUBKEY, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: bookData
  };

  latestBlockhash = (await rpc.getLatestBlockhash().send()).value;

  const bookTxMessage = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([bookEd25519Ix, bookFixtureInstruction], m)
  );

  signedTx = await signTransactionMessageWithSigners(bookTxMessage);
  assertIsTransactionWithBlockhashLifetime(signedTx);
  const bookTxSig = getSignatureFromTransaction(signedTx);
  await sendAndConfirm(signedTx, { commitment: 'confirmed' });
  console.log(`[${name}] Successfully booked fixture ${fixtureIdToBook} (TX: ${bookTxSig})`);

  await sleep(2000);

  // Execute generalized odds validation pipeline
  try {
    const mapProof = (proof: any[] | undefined) =>
      (proof || []).map(p => utils.formatPayloadToIdl(TxoracleJson, "proofNode", {
        hash: Array.from(p.hash || []),
        isRightSibling: p.isRightSibling
      }));

    // Configure static worker identifiers
    const domain = 0;
    const workerId = 1;

    const domainBuffer = new Uint8Array([domain]);
    const workerIdBuffer = new Uint8Array(2);
    new DataView(workerIdBuffer.buffer).setUint16(0, workerId, true);

    const mappedOddsSnapshot = utils.formatPayloadToIdl(TxoracleJson, "odds", {
      fixtureId: BigInt(targetPayload.oddsSnapshot.FixtureId),
      messageId: targetPayload.oddsSnapshot.MessageId,
      ts: BigInt(targetPayload.oddsSnapshot.Ts),
      bookmaker: targetPayload.oddsSnapshot.Bookmaker,
      bookmakerId: targetPayload.oddsSnapshot.BookmakerId,
      superOddsType: targetPayload.oddsSnapshot.SuperOddsType,
      gameState: targetPayload.oddsSnapshot.GameState || null,
      inRunning: targetPayload.oddsSnapshot.InRunning ?? false,
      marketParameters: targetPayload.oddsSnapshot.MarketParameters || null,
      marketPeriod: targetPayload.oddsSnapshot.MarketPeriod || null,
      priceNames: targetPayload.oddsSnapshot.PriceNames || [],
      prices: targetPayload.oddsSnapshot.Prices || [],
    });

    const serializedOdds = oddsEncoder.encode(mappedOddsSnapshot);
    const oddsLeafHash = createHash('sha256').update(new Uint8Array(serializedOdds)).digest();

    const mappedSummary = utils.formatPayloadToIdl(TxoracleJson, "batchSummary", {
      fixtureId: BigInt(targetPayload.summary.fixtureId),
      updateStats: {
        updateCount: targetPayload.summary.updateStats.updateCount,
        minTimestamp: BigInt(targetPayload.summary.updateStats.minTimestamp),
        maxTimestamp: BigInt(targetPayload.summary.updateStats.maxTimestamp),
      },
      subTreeRoot: Array.from(targetPayload.summary.oddsSubTreeRoot || (targetPayload.summary as any).subTreeRoot || [])
    });

    const mappedMainTreeProof = mapProof(targetPayload.mainTreeProof);
    const mappedSubTreeProof = mapProof(targetPayload.subTreeProof);

    const targetEpochDay = Math.floor(Number(targetPayload.ts) / (24 * 60 * 60 * 1000));
    const epochDayBuffer = new Uint8Array(2);
    new DataView(epochDayBuffer.buffer).setUint16(0, targetEpochDay, true);

    const [dailyBatchRootsPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [utf8Encoder.encode("daily_batch_roots"), epochDayBuffer]
    });

    console.log(`${dailyBatchRootsPda}: dailyBatchRootsPda`);
    const rootsAccount = await rpc.getAccountInfo(dailyBatchRootsPda, { encoding: 'base64' }).send();
    if (!rootsAccount.value) {
      throw new Error(`DailyBatchRoots PDA (${dailyBatchRootsPda}) is not initialized on mainnet for day ${targetEpochDay}`);
    }

    const [oddsTicketPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        utf8Encoder.encode("worker_ticket"),
        addressEncoder.encode(authority.address),
        domainBuffer,
        workerIdBuffer
      ]
    });

    // Map input struct for generalized tree validation
    const mappedFixtureForTreePayload = utils.formatPayloadToIdl(TxoracleJson, "fixtureForTreeValidationInput", {
      ts: BigInt(targetPayload.ts),
      domain: domain,
      workerId: workerId,
      summary: mappedSummary,
      mainTreeProof: mappedMainTreeProof
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
        { address: authority.address, role: AccountRole.WRITABLE_SIGNER },
        { address: oddsTicketPda, role: AccountRole.WRITABLE },
        { address: dailyBatchRootsPda, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY }
      ],
      data: fixtureData
    };

    // Map signed payload for V4 odds validation
    const mappedPayloadV4 = utils.formatPayloadToIdl(TxoracleJson, "oddsValidationInputV4", {
      ts: BigInt(targetPayload.ts),
      oddsLeafHash: Array.from(oddsLeafHash),
      subTreeProof: mappedSubTreeProof
    });

    const serializedPayload = oddsValidationInputV4Encoder.encode(mappedPayloadV4);
    const payloadHash = createHash('sha256').update(new Uint8Array(serializedPayload)).digest();

    const signatureBuffer = typeof targetV4Data.signature === 'string'
      ? base64Encoder.encode(targetV4Data.signature)
      : new Uint8Array(targetV4Data.signature);

    const validateOddsEd25519Ix = createEd25519Ix(
      addressEncoder.encode(BACKEND_ADMIN_PUBKEY),
      payloadHash,
      signatureBuffer
    );

    // Encode instruction arguments with worker identifier and payload
    const validateArgsData = validateOddsV4ArgsEncoder.encode({ 
      workerId, 
      payload: mappedPayloadV4 
    });
    const validateData = new Uint8Array(8 + validateArgsData.length);
    validateData.set(VALIDATE_ODDS_DISCRIMINATOR, 0);
    validateData.set(validateArgsData, 8);

    const validateOddsInstruction: Instruction = {
      programAddress: programId,
      accounts: [
        { address: authority.address, role: AccountRole.WRITABLE_SIGNER },
        { address: oddsTicketPda, role: AccountRole.READONLY },
        { address: fixtureTicketPda, role: AccountRole.WRITABLE },
        { address: SYSVAR_INSTRUCTIONS_PUBKEY, role: AccountRole.READONLY }
      ],
      data: validateData
    };

    // Construct instruction to reclaim rent
    const closeArgsData = closeWorkerTicketArgsEncoder.encode({ domain, workerId });
    const closeData = new Uint8Array(8 + closeArgsData.length);
    closeData.set(CLOSE_WORKER_DISCRIMINATOR, 0);
    closeData.set(closeArgsData, 8);

    const closeWorkerInstruction: Instruction = {
      programAddress: programId,
      accounts: [
        { address: authority.address, role: AccountRole.WRITABLE_SIGNER },
        { address: oddsTicketPda, role: AccountRole.WRITABLE }
      ],
      data: closeData
    };

    latestBlockhash = (await rpc.getLatestBlockhash().send()).value;

    console.log("\n[Real-Time] Initializing worker ticket via generalized tree validation (V1)");
    const tx1Message = pipe(
      // createTransactionMessage({ version: 1 }),
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(authority, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => setTransactionMessageComputeUnitLimit(1400000, m),
      (m) => setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, m),
      (m) => appendTransactionMessageInstruction(validateFixtureInstruction, m)
    );

    const signedTx1 = await signTransactionMessageWithSigners(tx1Message);
    assertIsTransactionWithBlockhashLifetime(signedTx1);
    const tx1Sig = getSignatureFromTransaction(signedTx1);

    try {
      await sendAndConfirm(signedTx1, { commitment: 'confirmed' });
      console.log(`[Real-Time] Initialized static odds validation ticket (TX: ${tx1Sig})`);
    } catch (err: any) {
      console.error("\n=== TX1 SIMULATION ERROR ===");

      const logs =
        err?.context?.logs ||
        err?.cause?.data?.logs ||
        err?.cause?.context?.logs ||
        err?.cause?.logs ||
        err?.logs;

      const txError =
        err?.context?.error ||
        err?.cause?.data?.err ||
        err?.cause?.err;

      if (txError) {
        console.error("Instruction Error:", JSON.stringify(txError, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
      }

      if (logs && Array.isArray(logs) && logs.length > 0) {
        console.error("Program Logs:\n" + logs.join("\n"));
      } else {
        console.error("Message:", err?.message || err?.cause?.message);
        console.error("Error Code:", err?.context?.__code || err?.cause?.code);
        console.dir(err?.cause?.data || err?.context || err, { depth: null });
      }

      process.exit(1);
    }

    await sleep(2000);

    console.log("[Real-Time] Executing odds validation from cached ticket (V1)");
    latestBlockhash = (await rpc.getLatestBlockhash().send()).value;

    const tx2Message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(authority, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => setTransactionMessageComputeUnitLimit(1400000, m),
      (m) => setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, m),
      (m) => appendTransactionMessageInstructions([validateOddsEd25519Ix, validateOddsInstruction], m)
    );

    const signedTx2 = await signTransactionMessageWithSigners(tx2Message);
    assertIsTransactionWithBlockhashLifetime(signedTx2);
    const tx2Sig = getSignatureFromTransaction(signedTx2);

    try {
      await sendAndConfirm(signedTx2, { commitment: 'confirmed' });

      // Retrieve confirmed transaction metadata
      let tx: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        tx = await rpc.getTransaction(tx2Sig, {
          commitment: 'confirmed',
          encoding: 'json',
          maxSupportedTransactionVersion: 1,
        }).send();
        if (tx) break;
        await sleep(500);
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

      console.log(`[Real-Time] Odds validation V4 executed and confirmed: result = ${validationResult} (TX: ${tx2Sig})`);
    } catch (err: any) {
      console.error("\n=== TX2 SIMULATION ERROR ===");

      // Extract logs across kit and standard Solana RPC data structures
      const logs =
        err?.context?.logs ||
        err?.cause?.data?.logs ||
        err?.cause?.context?.logs ||
        err?.cause?.logs ||
        err?.logs;

      const txError =
        err?.context?.error ||
        err?.cause?.data?.err ||
        err?.cause?.err;

      if (txError) {
        console.error("Instruction Error:", JSON.stringify(txError, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
      }

      if (logs && Array.isArray(logs) && logs.length > 0) {
        console.error("Program Logs:\n" + logs.join("\n"));
      } else {
        console.error("Message:", err?.message || err?.cause?.message);
        console.error("Error Code:", err?.context?.__code || err?.cause?.code);
        console.dir(err?.cause?.data || err?.context || err, { depth: null });
      }

      process.exit(1);
    }

    await sleep(2000);

    console.log("\n[Real-Time] Closing worker ticket to reclaim rent");
    const { value: latestBlockhashClose } = await rpc.getLatestBlockhash().send();
    const tx3Message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(authority, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhashClose, m),
      (m) => appendTransactionMessageInstruction(closeWorkerInstruction, m)
    );

    const signedTx3 = await signTransactionMessageWithSigners(tx3Message);
    assertIsTransactionWithBlockhashLifetime(signedTx3);
    const tx3Sig = getSignatureFromTransaction(signedTx3);
    await sendAndConfirm(signedTx3, { commitment: 'confirmed' });
    console.log(`[Real-Time] Worker ticket closed and rent reclaimed (TX: ${tx3Sig})`);

  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error("Odds validation V4 failed (API):", error.response?.data || error.message);
    } else {
      console.error("Odds validation V4 failed:", error.message || error);
    }
  }

  // Subscribe to real-time odds updates
  async function listenToOddsStream(streamId: string): Promise<void> {
    console.log(`[Odds] Subscribing to all permitted odds updates`);
    const streamUrl = `${config.API_BASE_URL}/odds/stream`;

    const eventSource = new EventSource(streamUrl, {
      fetch: async (input, init) => {
        const attemptFetch = (token: string) =>
          fetch(input, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string>),
              'Accept-Encoding': 'deflate',
              'Authorization': `Bearer ${token}`,
              'X-Api-Token': users.authState.apiToken,
            },
          });

        let response = await attemptFetch(users.authState.jwt);

        if (response.status === 403 || response.status === 401) {
          console.log(`[Scores - ${streamId}] SSE connection rejected. Renewing JWT`);
          const newJwt = await users.renewJwt();
          response = await attemptFetch(newJwt);
        }

        return response;
      },
    });

    eventSource.onopen = () => console.log(`[Odds] Stream connection opened`);
    eventSource.onerror = (err) => console.error(`[Odds] Stream connection error: ${err}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log(`[Odds] [UPDATE] ${event.lastEventId}:`, data);
    };
  }

  listenToOddsStream("1");

  const waitDuration = 3600 * 1000;
  console.log(`Waiting for ${waitDuration / 1000} seconds for odds to stream`);
  await new Promise(resolve => setTimeout(resolve, waitDuration));
}

main().then(() => process.exit(0));