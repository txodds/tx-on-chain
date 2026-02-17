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
import { randomBytes, createCipheriv } from "crypto";
import { Txoracle } from "../../types/txoracle";
import idl from "../../idl/txoracle.json";

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(
  idl.constants.find((c) => c.name === "TXLINE_MINT")!.value as string
);

async function main() {
  console.log("Starting scores streaming example");

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(idl as Txoracle, provider);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: "https://oracle-dev.txodds.com",
  });

  console.log("Authenticating...");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwtToken = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwtToken}`;

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
  console.log("User Token Account:", userTokenAccount.address.toBase58());

  let apiToken: string = "";

  console.log("Creating subscription...");

  const symmetricKey = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", symmetricKey, iv);
  let encryptedPayload = cipher.update(jwtToken, "utf8", "hex");
  encryptedPayload += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  const finalPayload = Buffer.concat([
    Buffer.from(encryptedPayload, "hex"),
    authTag,
  ]);

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

  const txSignature = await program.methods
    .subscribeWithToken(1, 1, finalPayload)
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

  const activationResponse = await axios.get(
    `https://oracle-dev.txodds.com/api/token/activate?txsig=${txSignature}&key=${symmetricKey.toString("base64url")}&iv=${iv.toString("base64url")}`,
    { headers: { Authorization: `Bearer ${jwtToken}` } }
  );
  apiToken = activationResponse.data.token || activationResponse.data;
  console.log("API token received");

  httpClient.defaults.headers.common["X-Api-Token"] = apiToken;

  console.log("Starting scores stream...");
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
