"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

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
