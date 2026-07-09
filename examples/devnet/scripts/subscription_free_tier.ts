// Discover a fixture from the current UTC window, fetch its odds, and probe odds SSE.
// Optional overrides: TXLINE_FIXTURE_ID and TXLINE_SSE_SECONDS (30..45).

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as config from "../common/config";
import * as users from "../common/users";
import {
  JsonObject,
  InconclusiveError,
  firstField,
  fixtureIdOverride,
  observeSse,
  requiredSafeInteger,
  safeError,
  sseDurationSeconds,
  summarizeSse,
} from "../common/flow";

function fixtureObjects(value: unknown): JsonObject[] {
  const found: JsonObject[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 7 || current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(item => visit(item, depth + 1));
      return;
    }
    const object = current as JsonObject;
    if (firstField(object, ["FixtureId", "fixtureId"]) !== undefined) {
      found.push(object);
      return;
    }
    Object.values(object).forEach(item => visit(item, depth + 1));
  };
  visit(value, 0);
  return found;
}

type OddsSelection = { fixtureId: number; oddsCount: number };

async function discoverFixtureWithOdds(): Promise<OddsSelection> {
  const override = fixtureIdOverride();
  const requestCap = 24;
  let requestCount = 0;
  const boundedGet = async (path: string, params?: Record<string, number>) => {
    requestCount++;
    if (requestCount > requestCap) {
      throw new Error(`Fixture/odds discovery exceeded its ${requestCap}-request cap`);
    }
    return users.apiClient.get(path, { params, timeout: 15_000 });
  };
  const tryOdds = async (fixtureId: number): Promise<OddsSelection | undefined> => {
    try {
      const odds = await boundedGet(`/odds/snapshot/${fixtureId}`, { asOf: Date.now() });
      if (odds.status < 200 || odds.status >= 300) {
        throw new Error(`unexpected HTTP ${odds.status}`);
      }
      if (!Array.isArray(odds.data) || odds.data.length === 0) return undefined;
      odds.data.forEach((record, index) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error(`odds snapshot record ${index} is not an object`);
        }
        const returned = firstField(record as JsonObject, ["FixtureId", "fixtureId"]);
        if (returned !== undefined && requiredSafeInteger(
          returned,
          `odds snapshot record ${index} FixtureId/fixtureId`,
          1,
        ) !== fixtureId) {
          throw new Error("odds snapshot returned a record for a different fixture");
        }
      });
      return { fixtureId, oddsCount: odds.data.length };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return undefined;
      throw safeError(error, `odds snapshot request for fixture ${fixtureId}`);
    }
  };

  if (override !== undefined) {
    const selected = await tryOdds(override);
    if (!selected) {
      throw new Error(`Odds snapshot for TXLINE_FIXTURE_ID=${override} contained no records`);
    }
    return selected;
  }

  const currentEpochDay = Math.floor(Date.now() / 86_400_000);
  const seen = new Set<number>();
  // Inspect records returned for yesterday through the next seven UTC days.
  for (let offset = -1; offset <= 7 && requestCount < requestCap; offset++) {
    const epochDay = currentEpochDay + offset;
    let response: Awaited<ReturnType<typeof boundedGet>>;
    try {
      response = await boundedGet("/fixtures/snapshot", { startEpochDay: epochDay });
    } catch (error) {
      throw safeError(error, "fixture snapshot request");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`fixture snapshot request returned unexpected HTTP ${response.status}`);
    }
    for (const fixture of fixtureObjects(response.data)) {
      const fixtureId = firstField(fixture, ["FixtureId", "fixtureId"]);
      let normalized: number;
      try {
        normalized = requiredSafeInteger(
          fixtureId,
          "fixture FixtureId/fixtureId",
          1,
        );
      } catch {
        // Continue to the next actual fixture record.
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      if (requestCount >= requestCap) break;
      const selected = await tryOdds(normalized);
      if (selected) return selected;
    }
  }
  throw new Error(
    `No fixture with a non-empty odds snapshot was available within the ${requestCap}-request current UTC scan`,
  );
}

async function main(): Promise<void> {
  fixtureIdOverride();
  const sseSeconds = sseDurationSeconds();
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, provider);
  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set");
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET is not set");
  const name = "Free-tier snapshot example";

  await users.setupUser(
    name,
    walletPath,
    new PublicKey(mintAddress),
    provider.connection,
    program,
    1,
    4,
    [],
    process.env.TXLINE_GUEST_JWT,
    process.env.TXLINE_API_TOKEN,
  );
  console.log("Authentication established; credentials are redacted");

  const { fixtureId, oddsCount } = await discoverFixtureWithOdds();
  console.log(`Odds snapshot pass for fixture ${fixtureId} (${oddsCount} record(s))`);

  const observation = await observeSse({
    url: `${config.API_BASE_URL}/odds/stream?fixtureId=${fixtureId}`,
    jwt: () => users.authState.jwt,
    apiToken: () => users.authState.apiToken,
    renewJwt: () => users.renewJwt(name),
    durationSeconds: sseSeconds,
  });
  summarizeSse("Odds SSE", observation);
}

main().then(
  () => process.exit(0),
  error => {
    if (error instanceof InconclusiveError) {
      console.error(`INCONCLUSIVE: ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "Free-tier example failed");
    process.exit(1);
  },
);
