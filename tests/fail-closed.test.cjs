"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tsNode = path.join(root, "node_modules", "ts-node", "dist", "bin.js");
const project = path.join(root, "examples", "devnet", "scripts", "tsconfig.json");

test("mandatory scripts reject invalid overrides before provider or network setup", () => {
  const cases = [
    ["subscription_scores.ts", { TXLINE_STAT_KEYS: "1,2" }, "exactly 1 key(s)"],
    ["subscription_scores_1stat.ts", { TXLINE_STAT_KEYS: "1,2" }, "exactly 1 key(s)"],
    ["subscription_scores_v2.ts", { TXLINE_STAT_KEYS: "1" }, "exactly 2 key(s)"],
    ["subscription_scores_v2a.ts", { TXLINE_STAT_KEYS: "1" }, "exactly 4 key(s)"],
    ["historical_scores.ts", { TXLINE_STAT_KEYS: "1,2" }, "exactly 1 key(s)"],
    ["fixture_validation_view_only.ts", { TXLINE_FIXTURE_ID: "not-an-integer" }, "TXLINE_FIXTURE_ID must be a safe integer"],
    ["subscription_free_tier.ts", { TXLINE_FIXTURE_ID: "not-an-integer" }, "TXLINE_FIXTURE_ID must be a safe integer"],
  ];

  for (const [script, overrides, expectedDiagnostic] of cases) {
    const env = {
      ...process.env,
      ...overrides,
    };
    for (const name of [
      "ANCHOR_PROVIDER_URL",
      "ANCHOR_WALLET",
      "TOKEN_MINT_ADDRESS",
      "TXLINE_API_TOKEN",
      "TXLINE_GUEST_JWT",
      "TXLINE_TX_SIG",
      "TXLINE_SEQ",
      "TXLINE_SSE_SECONDS",
    ]) delete env[name];
    if (!("TXLINE_FIXTURE_ID" in overrides)) delete env.TXLINE_FIXTURE_ID;
    if (!("TXLINE_STAT_KEYS" in overrides)) delete env.TXLINE_STAT_KEYS;

    const result = spawnSync(process.execPath, [
      tsNode,
      "--project",
      project,
      path.join(root, "examples", "devnet", "scripts", script),
    ], {
      cwd: root,
      env,
      encoding: "utf8",
      // ts-node startup can be CPU-bound when Node's test runner executes
      // multiple test files concurrently, especially on Windows CI hosts.
      timeout: 60_000,
    });

    assert.equal(result.error, undefined, `${script} failed to launch`);
    assert.equal(result.signal, null, `${script} was terminated by ${result.signal}`);
    assert.equal(result.status, 1, `${script} must fail closed`);
    assert.equal(
      result.stderr.includes(expectedDiagnostic),
      true,
      `${script} did not emit its expected safe preflight diagnostic`,
    );
  }
});
