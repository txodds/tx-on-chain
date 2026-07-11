"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { convertIdlToCamelCase } = require(path.join(
  root,
  "node_modules",
  "@coral-xyz",
  "anchor",
  "dist",
  "cjs",
  "idl.js",
));

function walk(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

function findings(files, pattern) {
  return files.flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(pattern)].map((match) => `${path.relative(root, file)}:${source.slice(0, match.index).split(/\r?\n/).length}`);
  });
}

const exampleFiles = walk(path.join(root, "examples"), (file) => file.endsWith(".ts"));
const publicTextFiles = [
  ...exampleFiles,
  ...walk(path.join(root, "documentation"), (file) => file.endsWith(".mdx")),
  path.join(root, "README.md"),
  path.join(root, "faq-overview.mdx"),
];
const publicDocumentationFiles = [
  ...walk(path.join(root, "documentation"), (file) => file.endsWith(".mdx")),
  path.join(root, "README.md"),
  path.join(root, "faq-overview.mdx"),
];

function generatedIdl(network) {
  const source = fs.readFileSync(
    path.join(root, "examples", network, "types", "txoracle.ts"),
    "utf8",
  );
  const marker = "export type Txoracle =";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${network} generated type must export Txoracle`);
  return JSON.parse(source.slice(start + marker.length).trim().replace(/;\s*$/, ""));
}

function sourceIdl(network) {
  return JSON.parse(fs.readFileSync(
    path.join(root, "examples", network, "idl", "txoracle.json"),
    "utf8",
  ));
}

test("examples do not print complete API tokens", () => {
  const exposed = findings(exampleFiles, /console\.(?:log|error)\([^\n]*(?:authState\.apiToken|\.apiToken\b)/gi);
  assert.deepEqual(exposed, []);
});

test("examples do not print or serialize authentication material and HTTP configs", () => {
  const consoleExposure = findings(
    exampleFiles,
    /console\.(?:log|error|warn)\([^;\n]*(?:\b(?:jwt|apiToken|walletSignature|secretKeyString)\b|Authorization|response\.data|error\.(?:config|request|response))/g,
  );
  const serializedExposure = findings(
    exampleFiles,
    /JSON\.stringify\([^;\n]*(?:\b(?:jwt|apiToken|walletSignature|secretKey)\b|Authorization|error|config|headers)/g,
  );
  assert.deepEqual(consoleExposure, []);
  assert.deepEqual(serializedExposure, []);
});

test("stream examples do not override compression negotiation or wait for an hour", () => {
  assert.deepEqual(findings(exampleFiles, /Accept-Encoding/gi), []);
  assert.deepEqual(findings(exampleFiles, /360[01]\s*\*\s*1000/g), []);
});

test("public guidance never recommends per-chunk gunzipSync", () => {
  assert.deepEqual(findings(publicTextFiles, /gunzipSync\s*\(/g), []);
});

test("default runnable flow has no embedded fixture/sequence proof pair or fixed epoch day", () => {
  const scripts = exampleFiles.filter((file) => file.includes(`${path.sep}scripts${path.sep}`));
  assert.deepEqual(findings(scripts, /fixtureId=\d+&seq=\d+/g), []);
  assert.deepEqual(findings(scripts, /startEpochDay=\d+/g), []);
  assert.deepEqual(
    findings(scripts, /(?:fixtureId|fixture_id|\bseq\b)\s*(?:=|:)\s*\d{2,}/gi),
    [],
  );
});

test("mandatory runnable scripts use fail-closed exit codes", () => {
  const names = [
    "subscription_scores.ts",
    "subscription_scores_1stat.ts",
    "subscription_scores_v2.ts",
    "subscription_scores_v2a.ts",
    "subscription_free_tier.ts",
    "fixture_validation_view_only.ts",
    "historical_scores.ts",
  ];
  for (const name of names) {
    const source = fs.readFileSync(path.join(root, "examples", "devnet", "scripts", name), "utf8");
    assert.match(source, /process\.exit\(1\)/, `${name} must exit 1 on failure`);
    assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{\s*console\.(?:log|error)[^}]*\}\s*[,;]?\s*$/s);
  }
});

test("source IDLs and generated TypeScript helpers are exactly synchronized", () => {
  for (const network of ["devnet", "mainnet"]) {
    const source = sourceIdl(network);
    const generated = generatedIdl(network);
    assert.deepEqual(generated, convertIdlToCamelCase(source), `${network} IDL/type parity`);
  }

  const rootSource = JSON.parse(fs.readFileSync(path.join(root, "idl", "txoracle.json"), "utf8"));
  const rootTypeSource = fs.readFileSync(path.join(root, "types", "txoracle.ts"), "utf8");
  const marker = "export type Txoracle =";
  const rootGenerated = JSON.parse(
    rootTypeSource.slice(rootTypeSource.indexOf(marker) + marker.length).trim().replace(/;\s*$/, ""),
  );
  assert.deepEqual(rootSource, sourceIdl("mainnet"), "root/mainnet source IDL parity");
  assert.deepEqual(rootGenerated, generatedIdl("mainnet"), "root/mainnet generated type parity");
});

test("public IDLs and documentation exclude internal trading instructions", () => {
  const publicInstructions = [
    "close_pricing_matrix",
    "initialize_pricing_matrix",
    "initialize_treasury_v2",
    "initialize_usdt_treasury",
    "insert_batch_root",
    "insert_fixtures_root",
    "insert_scores_root",
    "purchase_subscription_token_usdt",
    "subscribe",
    "update_pricing_matrix",
    "validate_fixture",
    "validate_fixture_batch",
    "validate_odds",
    "validate_stat",
    "validate_stat_v2",
    "withdraw_usdt",
  ];
  for (const network of ["devnet", "mainnet"]) {
    const expectedInstructions = [...publicInstructions];
    if (network === "devnet") {
      expectedInstructions.splice(expectedInstructions.indexOf("validate_stat_v2") + 1, 0, "validate_stat_v3");
    }
    assert.deepEqual(
      sourceIdl(network).instructions.map((instruction) => instruction.name),
      expectedInstructions,
      `${network} public instruction allowlist`,
    );
  }
  assert.deepEqual(
    findings(
      publicDocumentationFiles,
      /\b(?:audit_trade_result|auditTradeResult|claim_batch_legacy|claimBatchLegacy|claim_via_resolution|claimViaResolution|close_intent|closeIntent|create_intent|createIntent|create_trade|createTrade|execute_match|executeMatch|expose_structs|exposeStructs|publish_resolution_root|publishResolutionRoot|refund_batch|refundBatch|request_devnet_faucet|requestDevnetFaucet|settle_matched_trade|settleMatchedTrade|settle_trade|settleTrade)\b/g,
    ),
    [],
  );
});

test("IDL constants stay on their declared Solana network", () => {
  const constants = (network) => Object.fromEntries(
    sourceIdl(network).constants.map(({ name, value }) => [name, value]),
  );
  assert.equal(constants("devnet").TXLINE_MINT, "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
  assert.equal(constants("devnet").USDT_MINT, "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
  assert.equal(constants("mainnet").TXLINE_MINT, "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL");
  assert.equal(constants("mainnet").USDT_MINT, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
});

test("purchase quickstart never signs or broadcasts a backend-provided transaction", () => {
  const source = fs.readFileSync(path.join(root, "documentation", "quickstart.mdx"), "utf8");
  const start = source.indexOf("## Purchase TxL");
  const end = source.indexOf("## Subscribe On-Chain", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const purchaseSection = source.slice(start, end);
  assert.doesNotMatch(
    purchaseSection,
    /(?:\.(?:partialSign|sign|signTransaction|signAllTransactions|sendRawTransaction|sendTransaction|sendAndConfirm|rpc)|sendAndConfirmTransaction)\s*\(/,
  );
  assert.match(purchaseSection, /Signing blocked/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, "README.md"), "utf8"),
    /deserializes and signs/i,
  );
});

test("package runtime floor matches the locked Solana dependency graph", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.engines.node, ">=20.18.0");
  assert.equal(packageJson.packageManager, "yarn@1.22.22");
});
