import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as nacl from "tweetnacl";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

const SELECTED_LEAGUES: number[] = [];

async function main() {
  console.log("Initializing scores streaming example");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(idl as Txoracle, provider);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: "https://oracle-dev.txodds.com",
  });

  console.log("\nAuthenticating with guest token");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwt = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwt}`;

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer as any,
    SUBSCRIPTION_TOKEN_MINT,
    provider.wallet.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("User token account:", userTokenAccount.address.toBase58());

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    SUBSCRIPTION_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("\nSubscribing on-chain (service level 1, duration 1 week)");
  const txSig = await program.methods
    .subscribe(1, 1)
    .accounts({
      user: provider.wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: SUBSCRIPTION_TOKEN_MINT,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Transaction confirmed:", txSig);
  console.log(
    `Solana Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`
  );

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, provider.wallet.payer!.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  console.log("Activating API access");
  const activationResponse = await axios.post(
    "https://oracle-dev.txodds.com/api/token/activate",
    {
      txSig,
      walletSignature,
      leagues: SELECTED_LEAGUES,
    },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const apiToken = activationResponse.data.token || activationResponse.data;
  console.log("API access granted");

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  console.log("\nConnecting to scores stream");
  const streamUrl = "https://oracle-dev.txodds.com/api/scores/stream";
  const streamResponse = await fetch(streamUrl, {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      "X-Api-Token": apiToken,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });

  if (!streamResponse.ok) {
    throw new Error(`Stream failed: ${streamResponse.status}`);
  }

  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("Message: ")) {
          try {
            const data = JSON.parse(line.substring(6));
            console.log(data);
          } catch (e) {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
