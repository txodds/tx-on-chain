// Discover a current fixture record and require validateFixture.view() === true.
// TXLINE_FIXTURE_ID may restrict discovery to a reproducible fixture.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as users from "../common/users";
import {
  JsonObject,
  firstField,
  fixtureIdOverride,
  requiredSafeInteger,
  safeError,
} from "../common/flow";
import { decodeBytes32, decodeProofNodes } from "../common/proof";

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function fixtureRecords(value: unknown): JsonObject[] {
  const found: JsonObject[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 7 || current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(item => visit(item, depth + 1));
      return;
    }
    const candidate = current as JsonObject;
    if (
      firstField(candidate, ["FixtureId", "fixtureId"]) !== undefined
      && firstField(candidate, ["Ts", "ts"]) !== undefined
    ) {
      found.push(candidate);
      return;
    }
    Object.values(candidate).forEach(item => visit(item, depth + 1));
  };
  visit(value, 0);
  return found;
}

async function discoverFixture(): Promise<{ fixtureId: number; ts: number }> {
  const fixtureOverride = process.env.TXLINE_FIXTURE_ID
    ? requiredSafeInteger(process.env.TXLINE_FIXTURE_ID, "TXLINE_FIXTURE_ID", 1)
    : undefined;
  const now = Date.now();
  for (let offset = 0; offset < 12; offset++) {
    const target = new Date(now - offset * 60 * 60_000);
    const epochDay = Math.floor(target.getTime() / 86_400_000);
    const hour = target.getUTCHours();
    try {
      const response = await users.apiClient.get(`/fixtures/updates/${epochDay}/${hour}`, {
        timeout: 15_000,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`unexpected HTTP ${response.status}`);
      }
      for (const record of fixtureRecords(response.data)) {
        const fixtureId = requiredSafeInteger(
          firstField(record, ["FixtureId", "fixtureId"]),
          "fixture FixtureId/fixtureId",
          1,
        );
        const ts = requiredSafeInteger(
          firstField(record, ["Ts", "ts"]),
          "fixture Ts/ts (milliseconds)",
          1_000_000_000_000,
        );
        const pureId = fixtureId % 281_474_976_710_656;
        if (fixtureOverride === undefined || fixtureOverride === fixtureId || fixtureOverride === pureId) {
          return { fixtureId, ts };
        }
      }
    } catch (error) {
      throw safeError(error, "fixture updates request");
    }
  }
  throw new Error("No suitable fixture update was available in the bounded 12-hour window");
}

async function main(): Promise<void> {
  fixtureIdOverride();
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, provider);
  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set");
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET is not set");
  const name = "Fixture validation example";

  const user = await users.setupUser(
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
  const userProgram = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(user.user),
      anchor.AnchorProvider.defaultOptions(),
    ),
  );

  const selected = await discoverFixture();
  let validation: JsonObject;
  try {
    const response = await users.apiClient.get("/fixtures/validation", {
      params: { fixtureId: selected.fixtureId, timestamp: selected.ts },
      timeout: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`unexpected HTTP ${response.status}`);
    }
    validation = object(response.data, "fixture-validation response");
  } catch (error) {
    throw safeError(error, "fixture-validation request");
  }

  const rawSnapshot = object(validation.snapshot, "validation.snapshot");
  const rawSummary = object(validation.summary, "validation.summary");
  const rawUpdateStats = object(rawSummary.updateStats, "validation.summary.updateStats");
  const packedIdRaw = firstField(rawSnapshot, ["FixtureId", "fixtureId"]);
  if (packedIdRaw === undefined || packedIdRaw === null) {
    throw new Error("Missing validation.snapshot.FixtureId");
  }
  const packedId = new anchor.BN(String(packedIdRaw));
  const packedDivisor = new anchor.BN(2).pow(new anchor.BN(48));
  const pureFixtureIdBN = packedId.mod(packedDivisor);
  const requestedPureIdBN = new anchor.BN(selected.fixtureId).mod(packedDivisor);
  if (!pureFixtureIdBN.eq(requestedPureIdBN)) {
    throw new Error("Validation response packed FixtureId does not match the requested fixture");
  }
  const gameState = packedId.div(packedDivisor).toNumber();
  const separateGameState = firstField(rawSnapshot, ["GameState", "gameState"]);
  if (separateGameState !== undefined) {
    const separateStateCode = requiredSafeInteger(
      separateGameState,
      "snapshot GameState/gameState",
      0,
    );
    if (separateStateCode !== gameState) {
      throw new Error("Separate GameState does not match the high bits of packed FixtureId");
    }
  }
  const summaryFixtureId = requiredSafeInteger(
    firstField(rawSummary, ["fixtureId", "FixtureId"]),
    "summary.fixtureId",
    1,
  );
  if (new anchor.BN(summaryFixtureId).mod(packedDivisor).toNumber() !== requestedPureIdBN.toNumber()) {
    throw new Error("Fixture validation summary does not match the requested fixture");
  }
  const snapshotTs = requiredSafeInteger(
    firstField(rawSnapshot, ["Ts", "ts"]),
    "snapshot.Ts/ts (milliseconds)",
    1_000_000_000_000,
  );
  if (snapshotTs !== selected.ts) {
    throw new Error("Fixture validation timestamp does not match the selected update timestamp");
  }

  const participant1IsHome = firstField(rawSnapshot, ["Participant1IsHome", "participant1IsHome"]);
  if (typeof participant1IsHome !== "boolean") {
    throw new Error("snapshot.Participant1IsHome must be boolean");
  }
  const snapshot = {
    ts: new anchor.BN(snapshotTs),
    startTime: new anchor.BN(requiredSafeInteger(firstField(rawSnapshot, ["StartTime", "startTime"]), "snapshot.StartTime", 1)),
    competition: requiredString(firstField(rawSnapshot, ["Competition", "competition"]), "snapshot.Competition"),
    competitionId: requiredSafeInteger(firstField(rawSnapshot, ["CompetitionId", "competitionId"]), "snapshot.CompetitionId"),
    fixtureGroupId: requiredSafeInteger(firstField(rawSnapshot, ["FixtureGroupId", "fixtureGroupId"]), "snapshot.FixtureGroupId"),
    participant1Id: requiredSafeInteger(firstField(rawSnapshot, ["Participant1Id", "participant1Id"]), "snapshot.Participant1Id"),
    participant1: requiredString(firstField(rawSnapshot, ["Participant1", "participant1"]), "snapshot.Participant1"),
    participant2Id: requiredSafeInteger(firstField(rawSnapshot, ["Participant2Id", "participant2Id"]), "snapshot.Participant2Id"),
    participant2: requiredString(firstField(rawSnapshot, ["Participant2", "participant2"]), "snapshot.Participant2"),
    fixtureId: packedId,
    participant1IsHome,
  };
  const summary = {
    fixtureId: new anchor.BN(summaryFixtureId),
    competitionId: requiredSafeInteger(firstField(rawSummary, ["competitionId", "CompetitionId"]), "summary.competitionId"),
    competition: requiredString(firstField(rawSummary, ["competition", "Competition"]), "summary.competition"),
    updateStats: {
      updateCount: requiredSafeInteger(firstField(rawUpdateStats, ["updateCount", "UpdateCount"]), "summary.updateCount", 1),
      minTimestamp: new anchor.BN(requiredSafeInteger(firstField(rawUpdateStats, ["minTimestamp", "MinTimestamp"]), "summary.minTimestamp", 1)),
      maxTimestamp: new anchor.BN(requiredSafeInteger(firstField(rawUpdateStats, ["maxTimestamp", "MaxTimestamp"]), "summary.maxTimestamp", 1)),
    },
    updateSubTreeRoot: decodeBytes32(
      firstField(rawSummary, ["updateSubTreeRoot", "UpdateSubTreeRoot"]),
      "summary.updateSubTreeRoot",
    ),
  };

  const epochDay = Math.floor(snapshotTs / 86_400_000);
  const windowStartDay = Math.floor(epochDay / 10) * 10;
  if (windowStartDay < 0 || windowStartDay > 0xffff) {
    throw new Error(`Fixture proof timestamp produces unsupported ten-day window ${windowStartDay}`);
  }
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(windowStartDay);
  const [tenDailyFixturesRootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ten_daily_fixtures_roots"), seed],
    userProgram.programId,
  );
  const result = await userProgram.methods
    .validateFixture(
      snapshot,
      summary,
      decodeProofNodes(validation.subTreeProof, "subTreeProof"),
      decodeProofNodes(validation.mainTreeProof, "mainTreeProof"),
    )
    .accounts({ tenDailyFixturesRoots: tenDailyFixturesRootsPda })
    .preInstructions([
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ])
    .view();
  if (result !== true) throw new Error("validateFixture exact packed-ID proof returned false");
  console.log(
    `Fixture validation passed for packed ID ${packedId.toString()} (pure ${pureFixtureIdBN.toString()}, GameState ${gameState})`,
  );
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : "Fixture validation example failed");
    process.exit(1);
  },
);
