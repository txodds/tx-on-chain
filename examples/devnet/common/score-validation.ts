import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { AxiosInstance } from "axios";
import { decodeBytes32, decodeProofNodes } from "./proof";
import {
  JsonObject,
  ScoreSelection,
  firstField,
  requiredSafeInteger,
  safeError,
} from "./flow";

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function statKey(stat: unknown, label: string): number {
  const value = object(stat, label);
  return requiredSafeInteger(firstField(value, ["key", "Key", "statKey", "StatKey"]), `${label}.key`, 0, 0xffff_ffff);
}

function statPeriod(stat: unknown, label: string): number {
  const value = object(stat, label);
  return requiredSafeInteger(
    firstField(value, ["period", "Period"]),
    `${label}.period`,
    -0x8000_0000,
    0x7fff_ffff,
  );
}

function statValue(stat: unknown, label: string): number {
  const value = object(stat, label);
  statPeriod(value, label);
  return requiredSafeInteger(
    firstField(value, ["value", "Value"]),
    `${label}.value`,
    -0x8000_0000,
    0x7fff_ffff,
  );
}

function canonicalStat(stat: unknown, label: string): { key: number; value: number; period: number } {
  return {
    key: statKey(stat, label),
    value: statValue(stat, label),
    period: statPeriod(stat, label),
  };
}

function optionalEcho(body: JsonObject, names: string[]): number | undefined {
  const value = firstField(body, names);
  return value === undefined ? undefined : requiredSafeInteger(value, names.join("/"), 1);
}

function assertRequestEchoes(body: JsonObject, selection: ScoreSelection): void {
  const fixtureEcho = optionalEcho(body, ["FixtureId", "fixtureId"]);
  const seqEcho = optionalEcho(body, ["Seq", "seq"]);
  if (fixtureEcho !== undefined && fixtureEcho !== selection.fixtureId) {
    throw new Error(`Validation response fixture does not match requested fixture ${selection.fixtureId}`);
  }
  if (seqEcho !== undefined && seqEcho !== selection.seq) {
    throw new Error(`Validation response sequence does not match requested sequence ${selection.seq}`);
  }
  const summary = object(body.summary, "validation.summary");
  const summaryFixture = requiredSafeInteger(
    firstField(summary, ["fixtureId", "FixtureId"]),
    "validation.summary.fixtureId",
    1,
  );
  if (summaryFixture !== selection.fixtureId) {
    throw new Error(`Validation summary fixture does not match requested fixture ${selection.fixtureId}`);
  }
  const responseTs = requiredSafeInteger(
    firstField(body, ["Ts", "ts"]),
    "validation Ts/ts (milliseconds)",
    1_000_000_000_000,
  );
  if (responseTs !== selection.ts) {
    throw new Error(`Validation response timestamp does not match selected sequence ${selection.seq}`);
  }
}

function buildSharedPayload(body: JsonObject): {
  ts: BN;
  fixtureSummary: JsonObject;
  fixtureProof: ReturnType<typeof decodeProofNodes>;
  mainTreeProof: ReturnType<typeof decodeProofNodes>;
  eventStatRoot: number[];
  dailyScoresPdaSeed: Buffer;
} {
  const summary = object(body.summary, "validation.summary");
  const updateStats = object(summary.updateStats, "validation.summary.updateStats");
  const targetTs = requiredSafeInteger(
    firstField(updateStats, ["minTimestamp", "MinTimestamp"]),
    "validation.summary.updateStats.minTimestamp",
    1_000_000_000_000,
  );
  const epochDay = Math.floor(targetTs / 86_400_000);
  if (epochDay < 0 || epochDay > 0xffff) {
    throw new Error(`Proof timestamp produces unsupported epoch day ${epochDay}`);
  }
  return {
    ts: new BN(targetTs),
    fixtureSummary: {
      fixtureId: new BN(requiredSafeInteger(firstField(summary, ["fixtureId", "FixtureId"]), "summary.fixtureId", 1)),
      updateStats: {
        updateCount: requiredSafeInteger(firstField(updateStats, ["updateCount", "UpdateCount"]), "summary.updateCount", 1),
        minTimestamp: new BN(targetTs),
        maxTimestamp: new BN(requiredSafeInteger(
          firstField(updateStats, ["maxTimestamp", "MaxTimestamp"]),
          "summary.maxTimestamp",
          targetTs,
        )),
      },
      eventsSubTreeRoot: decodeBytes32(
        firstField(summary, ["eventStatsSubTreeRoot", "eventsSubTreeRoot"]),
        "summary.eventStatsSubTreeRoot",
      ),
    },
    fixtureProof: decodeProofNodes(body.subTreeProof, "subTreeProof"),
    mainTreeProof: decodeProofNodes(body.mainTreeProof, "mainTreeProof"),
    eventStatRoot: decodeBytes32(body.eventStatRoot, "eventStatRoot"),
    dailyScoresPdaSeed: new BN(epochDay).toArrayLike(Buffer, "le", 2),
  };
}

async function getValidation(
  apiClient: AxiosInstance,
  selection: ScoreSelection,
  params: Record<string, string | number>,
): Promise<JsonObject> {
  try {
    const response = await apiClient.get("/scores/stat-validation", {
      params: { fixtureId: selection.fixtureId, seq: selection.seq, ...params },
      timeout: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`unexpected HTTP ${response.status}`);
    }
    const body = object(response.data, "stat-validation response");
    assertRequestEchoes(body, selection);
    return body;
  } catch (error) {
    throw safeError(error, "stat-validation request");
  }
}

export async function validateLegacyExact(
  program: anchor.Program<any>,
  apiClient: AxiosInstance,
  selection: ScoreSelection,
): Promise<void> {
  const requestedKey = selection.statKeys[0];
  if (requestedKey === undefined) throw new Error("Legacy validation requires one stat key");
  const body = await getValidation(apiClient, selection, { statKey: requestedKey });
  const returnedStat = canonicalStat(body.statToProve, "statToProve");
  if (returnedStat.key !== requestedKey) {
    throw new Error("Legacy validation returned a different stat key than requested");
  }

  const shared = buildSharedPayload(body);
  const [dailyScoresPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), shared.dailyScoresPdaSeed],
    program.programId,
  );
  const exactValue = returnedStat.value;
  // Anchor's generated recursive instruction types can exceed TypeScript's
  // instantiation depth here; the payload was validated field-by-field above.
  const methods = program.methods as any;
  const result = await methods
    .validateStat(
      shared.ts,
      shared.fixtureSummary,
      shared.fixtureProof,
      shared.mainTreeProof,
      { threshold: exactValue, comparison: { equalTo: {} } },
      {
        statToProve: returnedStat,
        eventStatRoot: shared.eventStatRoot,
        statProof: decodeProofNodes(body.statProof, "statProof"),
      },
      null,
      null,
    )
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ])
    .view();

  if (result !== true) throw new Error("Legacy exact-value on-chain predicate returned false");
  console.log(`Legacy validation passed for fixture ${selection.fixtureId}, seq ${selection.seq}, stat ${requestedKey}`);
}

export async function validateV2Exact(
  program: anchor.Program<any>,
  apiClient: AxiosInstance,
  selection: ScoreSelection,
  options: { expectedPeriod?: number } = {},
): Promise<void> {
  if (selection.statKeys.length === 0) throw new Error("V2 validation requires at least one stat key");
  const body = await getValidation(apiClient, selection, { statKeys: selection.statKeys.join(",") });
  const stats = array(body.statsToProve, "statsToProve");
  const proofs = array(body.statProofs, "statProofs");
  if (stats.length !== selection.statKeys.length || proofs.length !== selection.statKeys.length) {
    throw new Error(
      `V2 response length mismatch: requested=${selection.statKeys.length}, stats=${stats.length}, proofs=${proofs.length}`,
    );
  }

  const canonicalStats = stats.map((stat, index) => canonicalStat(stat, `statsToProve[${index}]`));
  canonicalStats.forEach((stat, index) => {
    const returnedKey = stat.key;
    if (returnedKey !== selection.statKeys[index]) {
      throw new Error(
        `V2 positional key mismatch at ${index}: requested ${selection.statKeys[index]}, returned ${returnedKey}`,
      );
    }
    if (
      options.expectedPeriod !== undefined
      && stat.period !== options.expectedPeriod
    ) {
      throw new Error(
        `V2 stat period mismatch at ${index}: expected ${options.expectedPeriod}`,
      );
    }
  });

  const shared = buildSharedPayload(body);
  const [dailyScoresPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), shared.dailyScoresPdaSeed],
    program.programId,
  );
  const payload = {
    ts: shared.ts,
    fixtureSummary: shared.fixtureSummary,
    fixtureProof: shared.fixtureProof,
    mainTreeProof: shared.mainTreeProof,
    eventStatRoot: shared.eventStatRoot,
    stats: canonicalStats.map((stat, index) => ({
      stat,
      statProof: decodeProofNodes(proofs[index], `statProofs[${index}]`),
    })),
  };
  // Each payload position is covered exactly once. The threshold is derived
  // from that returned leaf, so a false result is always an actionable failure.
  const strategy = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: canonicalStats.map((stat, index) => ({
      single: {
        index,
        predicate: {
          threshold: stat.value,
          comparison: { equalTo: {} },
        },
      },
    })),
  };

  // See the legacy call above: runtime inputs are checked before this cast.
  const methods = program.methods as any;
  const result = await methods
    .validateStatV2(payload, strategy)
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ])
    .view();
  if (result !== true) throw new Error("V2 exact-value on-chain predicate returned false");
  console.log(
    `V2 validation passed for fixture ${selection.fixtureId}, seq ${selection.seq}, `
    + `stat order [${selection.statKeys.join(",")}]`,
  );
}

async function getValidationV3(
  apiClient: AxiosInstance,
  selection: ScoreSelection,
  params: Record<string, string | number>,
): Promise<JsonObject> {
  try {
    const response = await apiClient.get("/scores/stat-validation-v3", {
      params: { fixtureId: selection.fixtureId, seq: selection.seq, ...params },
      timeout: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`unexpected HTTP ${response.status}`);
    }
    const body = object(response.data, "stat-validation-v3 response");
    assertRequestEchoes(body, selection);
    return body;
  } catch (error) {
    throw safeError(error, "stat-validation-v3 request");
  }
}

export async function validateV3Exact(
  program: anchor.Program<any>,
  apiClient: AxiosInstance,
  selection: ScoreSelection,
  options: { expectedPeriod?: number } = {},
): Promise<void> {
  if (selection.statKeys.length === 0) throw new Error("V3 validation requires at least one stat key");
  if (selection.statKeys.length > 5) throw new Error("V3 validation supports at most 5 stat keys");
  const body = await getValidationV3(apiClient, selection, { statKeys: selection.statKeys.join(",") });
  const statsToProve = array(body.statsToProve, "statsToProve");
  if (statsToProve.length !== selection.statKeys.length) {
    throw new Error(
      `V3 response length mismatch: requested=${selection.statKeys.length}, statsToProve=${statsToProve.length}`,
    );
  }

  const multiproof = object(body.multiproof, "multiproof");
  const indices = array(multiproof.indices, "multiproof.indices");
  const hashes = array(multiproof.hashes, "multiproof.hashes");
  if (indices.length === 0) throw new Error("V3 multiproof.indices must not be empty");
  if (hashes.length === 0) throw new Error("V3 multiproof.hashes must not be empty");

  const canonicalStats = statsToProve.map((entry, index) => {
    const leaf = object(entry, `statsToProve[${index}]`);
    const stat = canonicalStat(leaf.stat ?? leaf, `statsToProve[${index}].stat`);
    return { stat, leaf };
  });
  canonicalStats.forEach(({ stat }, index) => {
    if (stat.key !== selection.statKeys[index]) {
      throw new Error(
        `V3 positional key mismatch at ${index}: requested ${selection.statKeys[index]}, returned ${stat.key}`,
      );
    }
    if (
      options.expectedPeriod !== undefined
      && stat.period !== options.expectedPeriod
    ) {
      throw new Error(
        `V3 stat period mismatch at ${index}: expected ${options.expectedPeriod}`,
      );
    }
  });

  const shared = buildSharedPayload(body);
  const [dailyScoresPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), shared.dailyScoresPdaSeed],
    program.programId,
  );
  const payload = {
    ts: shared.ts,
    fixtureSummary: shared.fixtureSummary,
    fixtureProof: shared.fixtureProof,
    mainTreeProof: shared.mainTreeProof,
    eventStatRoot: shared.eventStatRoot,
    leaves: canonicalStats.map(({ stat, leaf }, index) => ({
      stat,
      statProof: decodeProofNodes(
        (leaf as JsonObject).statProof ?? (leaf as JsonObject).StatProof,
        `statsToProve[${index}].statProof`,
      ),
    })),
    leafIndices: indices.map((v, i) =>
      requiredSafeInteger(v, `multiproof.indices[${i}]`, 0),
    ),
    multiproofHashes: decodeProofNodes(hashes, "multiproof.hashes"),
  };
  const strategy = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: canonicalStats.map(({ stat }, index) => ({
      single: {
        index,
        predicate: {
          threshold: stat.value,
          comparison: { equalTo: {} },
        },
      },
    })),
  };

  const methods = program.methods as any;
  const result = await methods
    .validateStatV3(payload, strategy)
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([
      anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ])
    .view();
  if (result !== true) throw new Error("V3 exact-value on-chain predicate returned false");
  console.log(
    `V3 multiproof validation passed for fixture ${selection.fixtureId}, seq ${selection.seq}, `
    + `stat order [${selection.statKeys.join(",")}]`,
  );
}
