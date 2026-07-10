"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
require(path.join(root, "node_modules", "ts-node")).register({
  transpileOnly: true,
  compilerOptions: {
    target: "es2022",
    module: "commonjs",
    moduleResolution: "node",
    esModuleInterop: true,
  },
});

const anchor = require(path.join(root, "node_modules", "@coral-xyz", "anchor"));
const {
  validateLegacyExact,
  validateV2Exact,
} = require(path.join(root, "examples", "devnet", "common", "score-validation.ts"));

const bytes32 = Array(32).fill(7);
const timestamp = 1_800_000_000_000;

function selection(statKeys) {
  return {
    record: {},
    fixtureId: 77,
    seq: 4,
    ts: timestamp,
    statKeys,
  };
}

function validationBody(stats) {
  return {
    FixtureId: "77",
    Seq: 4,
    Ts: String(timestamp),
    summary: {
      FixtureId: 77,
      updateStats: {
        updateCount: 1,
        minTimestamp: timestamp,
        maxTimestamp: timestamp,
      },
      eventStatsSubTreeRoot: bytes32,
    },
    subTreeProof: [],
    mainTreeProof: [],
    eventStatRoot: bytes32,
    statToProve: stats[0],
    statProof: [],
    statsToProve: stats,
    statProofs: stats.map(() => []),
  };
}

function api(body, requests) {
  return {
    async get(url, config) {
      requests?.push({ url, config });
      return { status: 200, data: body };
    },
  };
}

function fakeProgram(viewResult) {
  const calls = [];
  const chain = (kind, args) => ({
    accounts(value) {
      calls.at(-1).accounts = value;
      return this;
    },
    preInstructions(value) {
      calls.at(-1).preInstructions = value;
      return this;
    },
    async view() {
      if (viewResult instanceof Error) throw viewResult;
      return viewResult;
    },
  });
  return {
    calls,
    programId: anchor.web3.Keypair.generate().publicKey,
    methods: {
      validateStat(...args) {
        calls.push({ kind: "legacy", args });
        return chain("legacy", args);
      },
      validateStatV2(...args) {
        calls.push({ kind: "v2", args });
        return chain("v2", args);
      },
    },
  };
}

test("legacy validation uses an exact predicate and fails closed on false", async () => {
  const stat = { Key: 2, Value: 19, Period: 100 };
  const program = fakeProgram(false);
  await assert.rejects(
    validateLegacyExact(program, api(validationBody([stat])), selection([2])),
    /predicate returned false/,
  );
  assert.equal(program.calls.length, 1);
  const predicate = program.calls[0].args[4];
  assert.deepEqual(predicate, { threshold: 19, comparison: { equalTo: {} } });
  assert.deepEqual(program.calls[0].args[5].statToProve, {
    key: 2,
    value: 19,
    period: 100,
  });
});

test("legacy validation propagates a failed view simulation", async () => {
  const stat = { key: 1, value: 8, period: 2 };
  const program = fakeProgram(new Error("controlled simulation failure"));
  await assert.rejects(
    validateLegacyExact(program, api(validationBody([stat])), selection([1])),
    /controlled simulation failure/,
  );
});

test("V2 preserves requested order and covers each payload position exactly once", async () => {
  const stats = [
    { Key: "2", Value: "22", Period: "100" },
    { key: 1, value: 11, period: 100 },
  ];
  const requests = [];
  const program = fakeProgram(true);
  await validateV2Exact(
    program,
    api(validationBody(stats), requests),
    selection([2, 1]),
    { expectedPeriod: 100 },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/scores/stat-validation");
  assert.deepEqual(requests[0].config.params, {
    fixtureId: 77,
    seq: 4,
    statKeys: "2,1",
  });
  const [payload, strategy] = program.calls[0].args;
  assert.deepEqual(payload.stats.map((entry) => entry.stat), [
    { key: 2, value: 22, period: 100 },
    { key: 1, value: 11, period: 100 },
  ]);
  assert.deepEqual(
    strategy.discretePredicates.map((entry) => entry.single.index),
    [0, 1],
  );
  assert.deepEqual(
    strategy.discretePredicates.map((entry) => entry.single.predicate.threshold),
    [22, 11],
  );
});

test("V2 supports one, ordered, reversed, and multi-stat positional mappings", async () => {
  for (const keys of [[1], [1, 2], [2, 1], [1, 2, 3, 4]]) {
    const stats = keys.map((key) => ({ key, value: key * 10, period: 7 }));
    const program = fakeProgram(true);
    await validateV2Exact(program, api(validationBody(stats)), selection(keys));
    const [payload, strategy] = program.calls[0].args;
    assert.deepEqual(payload.stats.map((entry) => entry.stat.key), keys);
    assert.deepEqual(
      strategy.discretePredicates.map((entry) => entry.single.index),
      keys.map((_key, index) => index),
    );
  }
});

test("V2 rejects response length and positional-key mismatches before view", async () => {
  const oneStat = validationBody([{ key: 1, value: 11, period: 1 }]);
  const lengthProgram = fakeProgram(true);
  await assert.rejects(
    validateV2Exact(lengthProgram, api(oneStat), selection([1, 2])),
    /response length mismatch/,
  );
  assert.equal(lengthProgram.calls.length, 0);

  const reversed = validationBody([
    { key: 1, value: 11, period: 1 },
    { key: 2, value: 22, period: 1 },
  ]);
  const orderProgram = fakeProgram(true);
  await assert.rejects(
    validateV2Exact(orderProgram, api(reversed), selection([2, 1])),
    /positional key mismatch/,
  );
  assert.equal(orderProgram.calls.length, 0);
});

test("V2 rejects an unexpected release-specific finalisation period before view", async () => {
  const program = fakeProgram(true);
  await assert.rejects(
    validateV2Exact(
      program,
      api(validationBody([{ key: 1, value: 11, period: 7 }])),
      selection([1]),
      { expectedPeriod: 100 },
    ),
    /expected 100/,
  );
  assert.equal(program.calls.length, 0);
});

test("V2 rejects malformed roots and false exact predicates", async () => {
  const stat = { key: 1, value: 11, period: 1 };
  const malformed = validationBody([stat]);
  malformed.eventStatRoot = Array(31).fill(0);
  const malformedProgram = fakeProgram(true);
  await assert.rejects(
    validateV2Exact(malformedProgram, api(malformed), selection([1])),
    /exactly 32 bytes/,
  );
  assert.equal(malformedProgram.calls.length, 0);

  const falseProgram = fakeProgram(false);
  await assert.rejects(
    validateV2Exact(falseProgram, api(validationBody([stat])), selection([1])),
    /predicate returned false/,
  );
  assert.equal(falseProgram.calls.length, 1);
});
