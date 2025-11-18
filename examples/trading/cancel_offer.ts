import axios from "axios";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  Account,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import { randomBytes, createCipheriv } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  BASE_URL,
  KEYPAIR_PATH,
  RPC_ENDPOINT,
  TxOracleIDL,
  TOKEN_MINT,
} from "../../config";
import { inspect } from "util";
import { Offer, OfferTerms } from "./types";
import { handleSubscription } from "../../utils/subscription";

const predicate = {
  threshold: 11,
  comparison: { greaterThan: {} },
};

async function main() {
  console.log("Starting cancel offer example");

  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(userKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(TxOracleIDL, provider);

  console.log(`[Trader] Using wallet: ${userKeypair.publicKey.toBase58()}`);

  const httpClient = axios.create({
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
    baseURL: BASE_URL,
  });

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    userKeypair,
    TOKEN_MINT,
    userKeypair.publicKey
  );
  console.log(
    "[Trader] User Token Account:",
    userTokenAccount.address.toBase58()
  );

  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  console.log("[Trader] Authenticating...");
  const authResponse = await httpClient.post("/auth/guest/start");
  const jwtToken = authResponse.data.token;
  httpClient.defaults.headers.common["Authorization"] = `Bearer ${jwtToken}`;

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

  const txSig = await handleSubscription(
    program,
    userKeypair,
    userTokenAccount,
    TOKEN_MINT,
    finalPayload,
    "Trader"
  );

  const activationUrl = `${BASE_URL}/api/token/activate?txsig=${txSig}&key=${symmetricKey.toString(
    "base64url"
  )}&iv=${iv.toString("base64url")}`;

  const maxRetries = 3;
  let apiToken: string = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const activationResponse = await axios.get(activationUrl, {
        headers: { Authorization: `Bearer ${jwtToken}` },
        timeout: 15000,
      });
      apiToken = activationResponse.data;

      if (!apiToken) {
        throw new Error("No API token received");
      }

      console.log("[Trader] API token received");
      break;
    } catch (error) {
      console.log(`[Trader] Activation attempt ${attempt} failed`);

      if (attempt === maxRetries) {
        throw new Error("Failed to activate subscription after all attempts");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const httpClientTrader = axios.create({
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtToken}`,
      "X-Api-Token": apiToken,
    },
    baseURL: BASE_URL,
  });

  const depositAmount = new BN(60 * (10 ** 6));

  const [tradingVaultAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_vault"), userKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [tradingVaultTokensPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("trading_tokens"), userKeypair.publicKey.toBuffer()],
    program.programId
  );

  const userTokenBalance = await connection.getTokenAccountBalance(userTokenAccount.address);
  console.log(`[Trader] Current token balance: ${userTokenBalance.value.uiAmount}`);

  const tradingVaultAccountInfo = await connection.getAccountInfo(tradingVaultAccountPda);
  if (tradingVaultAccountInfo) {
    console.log(`[Trader] Trading vault exists. Checking balance...`);
  } else {
    console.log("[Trader] Depositing funds into on-chain Trading Vault...");
    try {
      const depositTx = await program.methods
        .deposit(depositAmount)
        .accounts({
          user: userKeypair.publicKey,
          oracleState: oracleStatePda,
          tradingVaultAccount: tradingVaultAccountPda,
          tradingVaultTokens: tradingVaultTokensPda,
          userTokenAccount: userTokenAccount.address,
          tokenMint: TOKEN_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .transaction();

      const depositSig = await provider.sendAndConfirm(depositTx, [userKeypair]);
      console.log(`[Trader] Deposit successful. Transaction signature: ${depositSig}`);
    } catch (err: any) {
      if (err.message?.includes('insufficient funds')) {
        console.log(`[Trader] Insufficient funds in token account. Skipping deposit.`);
      } else {
        throw err;
      }
    }
  }

  console.log("[Trader] Preparing to post a new order to the order book...");

  const offerTerms: OfferTerms = {
    fixtureId: new BN(17271370),
    period: 4,
    predicate,
    binaryOp: null,
    statA: { key: 1 },
    statB: null,
    stake: new BN(10 * (10 ** 6)),
    odds: 2000,
    expiration: new BN(Date.now() + 24 * 60 * 60 * 1000),
  };

  let offerId: number;
  try {
    const result = await postNewOrder(
      offerTerms,
      userKeypair,
      jwtToken,
      apiToken,
      "Trader"
    );
    console.log("[Trader] Order submission result:", result);

    // Extract offer ID from response string (format: "Offer 199 accepted.")
    const match = result.match(/Offer (\d+) accepted/);
    if (!match) {
      throw new Error(`Could not extract offer ID from response: ${result}`);
    }
    offerId = parseInt(match[1], 10);
  } catch (error) {
    console.error("[Trader] Error posting order:", error);
    process.exit(1);
  }

  console.log("\n[Trader] Waiting 3 seconds before cancelling the offer...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`[Trader] Cancelling offer with ID: ${offerId}...`);
  try {
    const cancelResponse = await httpClientTrader.post("/api/trading/offer/cancel", {
      offerId: offerId
    });
    console.log("[Trader] Offer cancelled successfully:", cancelResponse.data);
  } catch (error: any) {
    console.error("[Trader] Error cancelling offer:", error.response?.data || error.message);
  }

  console.log("\nCancel offer example completed.");
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}

async function postNewOrder(
  terms: OfferTerms,
  user: Keypair,
  jwt: string,
  apiToken: string,
  userName: string
) {
  console.log(`[${userName}] Posting a new offer to the order book...`);

  const offer = new Offer({
    ...terms,
    traderPubkey: user.publicKey,
  });
  console.log(`[${userName}] Prepared offer:`, inspect(offer, { depth: null, colors: true }));

  const serializedOffer = offer.serialize();
  console.log(`[${userName}] Client-side offer bytes:`, serializedOffer.toString('hex'));

  const signature = nacl.sign.detached(serializedOffer, user.secretKey);
  console.log(`[${userName}] Offer cryptographically signed. Signature (bs58): ${bs58.encode(signature)}`);

  const payload = {
    offer: {
      ...offer,
      fixtureId: offer.fixtureId.toNumber(),
      stake: offer.stake.toNumber(),
      expiration: offer.expiration.toNumber(),
      traderPubkey: offer.traderPubkey.toBase58(),
    },
    signature: bs58.encode(signature),
  };

  const response = await axios.post(`${BASE_URL}/api/trading/offer`, payload, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'X-Api-Token': apiToken
    }
  });

  console.log(`[${userName}] Offer successfully submitted. Server response:`, response.data);
  return response.data;
}
