// Run with
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="mainnet/keys/testuser-wallet.json" ts-node mainnet/scripts/show_pricing_matrix.ts

import TxoracleJson from "../idl/txoracle.json";
import * as fs from "fs";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  createKeyPairSignerFromBytes,
  sendAndConfirmTransactionFactory,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getStructEncoder,
  getU8Encoder,
  getU16Encoder,
  getU32Encoder,
  getU64Encoder,
  getStructDecoder,
  getU16Decoder,
  getU64Decoder,
  getU32Decoder,
  getI16Decoder,
  getAddressDecoder,
  getArrayDecoder,
} from "@solana/kit";

// Resolve numeric encoder from IDL or fallback to default
function resolveNumericEncoder(fieldName: string, fallbackEncoder: any) {
  const types = (TxoracleJson as any).types;
  const pricingRowDef = types?.find(
    (t: any) => t.name === "PricingMatrixRow" || t.name === "pricing_matrix_row"
  );
  const fields = pricingRowDef?.type?.fields || pricingRowDef?.fields;
  const field = fields?.find(
    (f: any) => f.name === fieldName || f.name === fieldName.replace(/([A-Z])/g, "_$1").toLowerCase()
  );

  if (!field) return fallbackEncoder;

  switch (field.type) {
    case "u8":
      return getU8Encoder();
    case "u16":
      return getU16Encoder();
    case "u32":
      return getU32Encoder();
    case "u64":
      return getU64Encoder();
    default:
      return fallbackEncoder;
  }
}

// Encode instruction payload arguments
const rowEncoder = getStructEncoder([
  ["rowId", resolveNumericEncoder("row_id", getU8Encoder())],
  ["pricePerWeekToken", resolveNumericEncoder("price_per_week_token", getU64Encoder())],
  ["samplingIntervalSec", resolveNumericEncoder("sampling_interval_sec", getU32Encoder())],
  ["leagueBundleId", resolveNumericEncoder("league_bundle_id", getU8Encoder())],
  ["marketBundleId", resolveNumericEncoder("market_bundle_id", getU8Encoder())],
]);

async function main() {
  // Initialize connection using environment URL or devnet fallback
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(rpcUrl);

  // Establish WebSocket client for confirmation
  const wsUrl = rpcUrl.replace("https://", "wss://").replace("http://", "ws://");
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

  // Initialize transaction factory to bundle send and confirm steps
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // Resolve program identifier from IDL
  const programIdString = (TxoracleJson as any).address || (TxoracleJson as any).metadata?.address;
  if (!programIdString) throw new Error("Program ID not found in IDL");
  const programId = address(programIdString);

  // Load authority signer from wallet keypair file
  const walletPath = process.env.ANCHOR_WALLET || "./devnet/keys/devnet-wallet-2.json";
  let authoritySigner;
  try {
    const secretKeyString = fs.readFileSync(walletPath, "utf8");
    const secretKey = new Uint8Array(JSON.parse(secretKeyString));
    authoritySigner = await createKeyPairSignerFromBytes(secretKey);
    console.log(`[Matrix] Loaded authority keypair: ${authoritySigner.address}`);
  } catch (err) {
    console.error(`Failed to load authority keypair at ${walletPath}`);
    throw err;
  }

  // Derive pricing matrix PDA
  const [matrixPda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [getUtf8Encoder().encode("pricing_matrix")],
  });

  console.log(`[Matrix] Target pricing matrix PDA: ${matrixPda}`);

    // Exact match to Rust PricingMatrix struct
    const pricingMatrixRowDecoder = getStructDecoder([
      ['rowId', getU16Decoder()],
      ['pricePerWeekToken', getU64Decoder()],
      ['samplingIntervalSec', getU32Decoder()],
      ['leagueBundleId', getI16Decoder()],
      ['marketBundleId', getI16Decoder()],
    ]);
  
    const pricingMatrixDecoder = getStructDecoder([
      ['admin', getAddressDecoder()],
      ['rows', getArrayDecoder(pricingMatrixRowDecoder, { size: getU32Decoder() })]
    ]);
  
    async function discoverPricingMatrix() {
      const { value: matrixAccount } = await rpc.getAccountInfo(matrixPda, { encoding: 'base64' }).send();
      
      if (!matrixAccount) {
        console.log(`[${name}] Pricing matrix account not found on-chain`);
        return;
      }
      
      // Extract base64 payload and drop 8-byte discriminator
      const rawData = Buffer.from(matrixAccount.data[0], 'base64');
      const dataWithoutDiscriminator = new Uint8Array(rawData.subarray(8));
      
      const matrix = pricingMatrixDecoder.decode(dataWithoutDiscriminator);
  
      console.log(`Pricing matrix by authority: ${matrix.admin}`); 
      console.log(`Service level id.  Tokens/week   Sampling (sec)  League bundle  Market bundle`);
      console.log(`=================  ===========   ==============  =============  =============`);
  
      matrix.rows.forEach((row: any) => {
        console.log(
          String(row.rowId).padStart(12, " ")
          + String(row.pricePerWeekToken).padStart(17, " ")
          + String(row.samplingIntervalSec).padStart(15, " ")
          + String(row.leagueBundleId).padStart(15, " ")
          + String(row.marketBundleId).padStart(12, " ")
        );
      });        
    }
    
    await discoverPricingMatrix();

}

// Execute main update workflow
main().catch((err) => {
  console.error("Matrix update failed:", err);
  process.exit(1);
});