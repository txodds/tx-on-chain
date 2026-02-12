import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const USDT_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "USDT_MINT")!.value as string
);
const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function main() {
  console.log("Checking treasury status...\n");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(idl as Txoracle, provider);

  console.log(`Program ID: ${program.programId.toBase58()}\n`);

  // Check USDT Mint
  console.log("=== USDT Mint ===");
  console.log(`Address: ${USDT_MINT.toBase58()}`);
  try {
    const usdtMintInfo = await provider.connection.getAccountInfo(USDT_MINT);
    console.log(`Status: ${usdtMintInfo ? "✅ Exists" : "❌ Not found"}`);
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  // Check Subscription Token Mint (Token-2022)
  console.log("\n=== Subscription Token Mint (TXLINE) ===");
  console.log(`Address: ${SUBSCRIPTION_TOKEN_MINT.toBase58()}`);
  try {
    const tokenMintInfo = await provider.connection.getAccountInfo(SUBSCRIPTION_TOKEN_MINT);
    console.log(`Status: ${tokenMintInfo ? "✅ Exists" : "❌ Not found"}`);
    if (tokenMintInfo) {
      console.log(`Owner: ${tokenMintInfo.owner.toBase58()}`);
    }
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  // Check USDT Treasury PDA
  const [usdtTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdt_treasury")],
    program.programId
  );
  console.log("\n=== USDT Treasury PDA ===");
  console.log(`Address: ${usdtTreasuryPda.toBase58()}`);
  try {
    const usdtTreasuryInfo = await provider.connection.getAccountInfo(usdtTreasuryPda);
    console.log(`Status: ${usdtTreasuryInfo ? "✅ Exists" : "❌ Not initialized"}`);
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  // Check USDT Treasury Vault (ATA)
  const [usdtTreasuryVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdt_treasury"), USDT_MINT.toBuffer()],
    program.programId
  );
  console.log("\n=== USDT Treasury Vault ===");
  console.log(`Address: ${usdtTreasuryVault.toBase58()}`);
  try {
    const vaultInfo = await provider.connection.getAccountInfo(usdtTreasuryVault);
    console.log(`Status: ${vaultInfo ? "✅ Exists" : "❌ Not initialized"}`);
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  // Check Token Treasury PDA
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury")],
    program.programId
  );
  console.log("\n=== Token Treasury PDA ===");
  console.log(`Address: ${tokenTreasuryPda.toBase58()}`);
  try {
    const tokenTreasuryInfo = await provider.connection.getAccountInfo(tokenTreasuryPda);
    console.log(`Status: ${tokenTreasuryInfo ? "✅ Exists" : "❌ Not initialized"}`);
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  // Check Token Treasury Vault (ATA for Token-2022)
  const [tokenTreasuryVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury"), SUBSCRIPTION_TOKEN_MINT.toBuffer()],
    program.programId
  );
  console.log("\n=== Token Treasury Vault (Token-2022) ===");
  console.log(`Address: ${tokenTreasuryVault.toBase58()}`);
  try {
    const vaultInfo = await provider.connection.getAccountInfo(tokenTreasuryVault);
    console.log(`Status: ${vaultInfo ? "✅ Exists" : "❌ Not initialized"}`);
    if (vaultInfo) {
      console.log(`Owner: ${vaultInfo.owner.toBase58()}`);
    }
  } catch (error) {
    console.log("Status: ❌ Error checking");
  }

  console.log("\n");
}

if (require.main === module) {
  main().catch(console.error);
}
