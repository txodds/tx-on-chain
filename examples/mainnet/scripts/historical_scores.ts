// Demo for fetching the full historical scores log for a specific fixture

// Run from the project root using this command:
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node  examples/mainnet/scripts/historical_scores.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as config from '../common/config';
import * as users from '../common/users';
import { PublicKey } from "@solana/web3.js";
import axios from "axios";

function returnedFixtureId(record: unknown, index: number): number {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Historical record ${index} is not an object`);
  }
  const object = record as Record<string, unknown>;
  const value = object.FixtureId ?? object.fixtureId;
  if (value === undefined || value === null) {
    throw new Error(`Historical record ${index} is missing FixtureId/fixtureId`);
  }
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Historical record ${index} has an invalid FixtureId/fixtureId`);
  }
  return parsed;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    provider
  );
  const connection = provider.connection;

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  const tokenMint = new PublicKey(mintAddress);

  console.log("Program ID:", program.programId.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());

  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET is not set");
  const name = "Trader A";
  const fixtureId = Number(process.env.TXLINE_FIXTURE_ID);
  if (!Number.isSafeInteger(fixtureId) || fixtureId < 1) {
    throw new Error("TXLINE_FIXTURE_ID must be set to a positive safe integer");
  }

  await users.setupUser(
    name,
    walletPath,
    tokenMint,
    connection,
    program,
    1,
    4,
    [],
    process.env.TXLINE_GUEST_JWT,
    process.env.TXLINE_API_TOKEN
  )
  console.log("Authentication established; credentials are redacted");

  try {
    // Mainnet is never probed by the devnet audit. An explicit fixture keeps
    // this mirrored example free of a stale default identifier.
    async function fetchHistoricalScores(fixtureId: number) {
      const updateUrl = `${config.API_BASE_URL}/scores/historical/${fixtureId}`;
      
      try {
        const response = await users.apiClient.get(updateUrl)
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Historical request returned unexpected HTTP ${response.status}`);
        }
        const records: unknown[] = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.records)
            ? response.data.records
            : [];
        if (records.length > 0) {
          records.forEach((record, index) => {
            const returned = returnedFixtureId(record, index);
            if (returned !== fixtureId) {
              throw new Error(`Historical record ${index} does not match requested fixture ${fixtureId}`);
            }
          });
          console.log(`Historical scores pass for fixtureId ${fixtureId}: ${records.length} record(s)`)
        } else {
          throw new Error("Historical endpoint returned success, but data is empty");
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          throw new Error(`Historical request failed${error.response?.status ? ` with HTTP ${error.response.status}` : ""}`)
        }
        throw error
      }
    }

    await fetchHistoricalScores(fixtureId);

} catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Request failed${error.response?.status ? ` with HTTP ${error.response.status}` : ""}`);
    }
    throw error;
  }

}

main().then(() => process.exit(0), error => {
  console.error(error instanceof Error ? error.message : "Historical scores example failed");
  process.exit(1);
});
