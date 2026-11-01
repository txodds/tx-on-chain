// Demonstrate fetching the full historical scores log for a specific fixture

// Run from the project root using this command
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="mainnet/keys/testuser-wallet.json" ts-node mainnet/scripts/historical_scores.ts

import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import axios from "axios";
import {
  AccountRole,
  Address,
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getStructEncoder,
  getU32Encoder,
  getUtf8Encoder,
  Instruction,
  pipe,
  ReadonlyUint8Array,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { createHash } from "crypto";
import { Ed25519Program } from "@solana/web3.js";
import * as utils from '../common/utils';

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

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com";
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");

  // Initialize network clients
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });


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

  try {
    const targetFixtureId = 18041503; // 18041518; // 18041503

    // Derive fixture ticket address using four-byte fixture identifier
    const fixtureIdBytes = getU32Encoder().encode(targetFixtureId);
    
    // Instantiate reusable encoders
    const utf8Encoder = getUtf8Encoder();
    const addressEncoder = getAddressEncoder();
    const base64Encoder = getBase64Encoder();

    const [fixtureTicketPda] = await getProgramDerivedAddress({
      programAddress: programId,
      seeds: [
        utf8Encoder.encode("fixture_ticket"),
        addressEncoder.encode(user.user.address),
        fixtureIdBytes
      ]
    });
  
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

      const bookFixturePayloadEncoder = utils.createIdlEncoder(TxoracleJson, "bookFixturePayload");
      const bookFixtureArgsEncoder = getStructEncoder([
        ['payload', bookFixturePayloadEncoder]
      ]);
      
      // Encode quote signature and payload hash
      const serializedQuotePayload = bookFixturePayloadEncoder.encode(mappedQuotePayload);
      const quotePayloadHash = createHash('sha256').update(new Uint8Array(serializedQuotePayload)).digest();
      const quoteSignatureBuffer = base64Encoder.encode(quoteResponse.signature);

      // Define program constants
      const SYSVAR_INSTRUCTIONS_PUBKEY = address("Sysvar1nstructions1111111111111111111111111");
      const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
      const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

      const BACKEND_ADMIN_PUBKEY = address(
        (TxoracleJson as any).constants?.find((c: any) => c.name === "BACKEND_ADMIN_PUBKEY")?.value ??
        "4nKMUKBLC3Th2dkFi3WFSoQc2xBCTLrmPFUmtauE8RMc"
      );

      const bookEd25519Ix = createEd25519Ix(
        addressEncoder.encode(BACKEND_ADMIN_PUBKEY),
        quotePayloadHash,
        quoteSignatureBuffer
      );

      const bookArgsData = bookFixtureArgsEncoder.encode({ payload: mappedQuotePayload });
      const bookData = new Uint8Array(8 + bookArgsData.length);

      // Precompute instruction discriminators
      function getDiscriminator(name: string): Uint8Array {
        return createHash("sha256").update(name).digest().subarray(0, 8);
      }

      // Compute associated token account address natively
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
      
      // Derive reusable program addresses
      const [tokenTreasuryPda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [utf8Encoder.encode("token_treasury_v2")]
      });
            
      const BOOK_DISCRIMINATOR = getDiscriminator("global:book_fixture");
      const userTokenAccount = await getAtaAddress(user.user.address, tokenMint);
      const tokenTreasuryVault = await getAtaAddress(tokenTreasuryPda, tokenMint);

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

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      await sleep(2000);
    } else {
      console.log(`[${name}] Fixture ${targetFixtureId} already booked on-chain, reusing existing ticket`);
    }

    // Fetch scores snapshot for a specific fixture
    async function fetchHistoricalScores(fixtureId: number) {
      const updateUrl = `${config.API_BASE_URL}/scores/historical/${fixtureId}`;

      try {
        const response = await users.apiClient.get(updateUrl, {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        if (response.data.length > 0) {
          console.log(`Scores updates found for fixtureId ${fixtureId}:`, response.data);
        } else {
          console.log("Historical endpoint returned success, but data is empty.");
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

    await fetchHistoricalScores(targetFixtureId);    

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);