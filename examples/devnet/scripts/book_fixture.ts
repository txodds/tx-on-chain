// TODO: Does not seem to work at the quote getting stage

// Demonstrate direct fixture booking with TXLINE targeting devnet
// Run from the project root using this command
// TOKEN_MINT_ADDRESS=4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" ANCHOR_WALLET="_keys/testuser-wallet-2.json" ts-node examples/devnet/scripts/book_fixture.ts

import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import * as utils from '../common/utils';
import axios from "axios";
import { createHash, randomInt } from "crypto";
import {
  address,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  getBase64Encoder,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getStructEncoder,
  getU32Encoder,
  getSignatureFromTransaction,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { Ed25519Program } from "@solana/web3.js";

// Construct Ed25519 instruction using Web3 helper
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

// Set up dynamic encoders
const bookFixturePayloadEncoder = utils.createIdlEncoder(TxoracleJson, "bookFixturePayload");

// Define instruction argument encoders
const bookFixtureArgsEncoder = getStructEncoder([
  ['payload', bookFixturePayloadEncoder]
]);

// Instantiate reusable encoders
const utf8Encoder = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const base64Encoder = getBase64Encoder();
const u32Encoder = getU32Encoder();

// Precompute instruction discriminators
function getDiscriminator(name: string): Uint8Array {
  return createHash("sha256").update(name).digest().subarray(0, 8);
}

const BOOK_DISCRIMINATOR = getDiscriminator("global:book_fixture");

// Define program constants
const SYSVAR_INSTRUCTIONS_PUBKEY = address("Sysvar1nstructions1111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Extract backend admin pubkey dynamically from IDL constants
const BACKEND_ADMIN_PUBKEY = address(
  (TxoracleJson as any).constants?.find((c: any) => c.name === "BACKEND_ADMIN_PUBKEY")?.value ??
  "4nKMUKBLC3Th2dkFi3WFSoQc2xBCTLrmPFUmtauE8RMc"
);

// Derive associated token account address
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
  console.log("Token Program:", TOKEN_2022_PROGRAM_ID);

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
    // Fetch fixture schedule
    console.log(`\n[${name}] Fetching fixture schedule...`);
    const scheduleUrl = `${config.API_BASE_URL}/fixtures-schedule`;
    const scheduleRes = await users.apiClient.get(scheduleUrl, { userName: name } as any);
    const scheduleResponse = scheduleRes.data;

    console.log(`[${name}] Schedule received:`, scheduleResponse);

    const targetFixtureId = process.env.FIXTURE_ID
      ? parseInt(process.env.FIXTURE_ID, 10)
      : 18146851; // 17737032;

    console.log(`[${name}] Target fixture: ${targetFixtureId}`);

    // Derive program derived addresses
    const [tokenTreasuryPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [utf8Encoder.encode("token_treasury_v2")]
    });

    const fixtureIdBytes = u32Encoder.encode(targetFixtureId);

    const [fixtureTicketPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        utf8Encoder.encode("fixture_ticket"),
        addressEncoder.encode(user.user.address),
        fixtureIdBytes
      ]
    });

    const userTokenAccount = await getAtaAddress(user.user.address, tokenMint);
    const tokenTreasuryVault = await getAtaAddress(tokenTreasuryPda, tokenMint);

    // Check if fixture ticket is already initialized on-chain
    const { value: existingFixtureTicket } = await rpc.getAccountInfo(fixtureTicketPda).send();

    if (existingFixtureTicket) {
      console.log(`[${name}] Fixture ${targetFixtureId} already booked on-chain, ticket exists`);
      return;
    }

    // Fetch booking quote
    console.log(`\n[${name}] Fetching quote for fixture ${targetFixtureId}...`);
    const quoteUrl = `${config.API_BASE_URL}/quotes/book-fixture?fixtureId=${targetFixtureId}&pubkey=${user.user.address}`;
    const quoteRes = await users.apiClient.get(quoteUrl, { userName: name } as any);
    const quoteResponse = quoteRes.data;

    console.log(`[${name}] Quote received:`, quoteResponse.payload);

    // Format quote payload to match IDL casing and types
    const mappedQuotePayload = utils.formatPayloadToIdl(TxoracleJson, "bookFixturePayload", {
      user: address(quoteResponse.payload.user),
      fixtureId: quoteResponse.payload.fixtureId,
      price: typeof quoteResponse.payload.price === "bigint" ? quoteResponse.payload.price : BigInt(quoteResponse.payload.price),
      ts: BigInt(quoteResponse.payload.ts),
      validity: BigInt(quoteResponse.payload.validity),
    });

    // Serialize payload and generate Ed25519 signature verification instruction
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

    // Build and submit fixture booking transaction
    console.log(`\n[${name}] Submitting fixture booking transaction...`);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const bookTxMessage = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayerSigner(user.user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([bookEd25519Ix, bookFixtureInstruction], m)
    );

    const signedTx = await signTransactionMessageWithSigners(bookTxMessage);
    assertIsTransactionWithBlockhashLifetime(signedTx);
    const bookTxSig = getSignatureFromTransaction(signedTx);
    await sendAndConfirm(signedTx, { commitment: 'confirmed' });

    console.log(`[${name}] Successfully booked fixture ${targetFixtureId} for ${quoteResponse.payload.price} raw TXLINE (TX: ${bookTxSig})`);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("API Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Execution Error:", error);
    }
    process.exit(1);
  }
}

main().then(() => process.exit(0));
