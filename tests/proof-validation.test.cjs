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

function proofModules() {
  return ["devnet", "mainnet"].map(network => ({
    network,
    proof: require(path.join(root, "examples", network, "common", "proof.ts")),
  }));
}

test("bytes32 decoding accepts only exact canonical values", () => {
  for (const { network, proof } of proofModules()) {
    const bytes = Array.from({ length: 32 }, (_, index) => index);
    const hex = `0x${Buffer.from(bytes).toString("hex")}`;
    const base64 = Buffer.from(bytes).toString("base64");

    assert.deepEqual(proof.decodeBytes32(bytes, "root"), bytes, network);
    assert.deepEqual(proof.decodeBytes32(Uint8Array.from(bytes), "root"), bytes, network);
    assert.deepEqual(proof.decodeBytes32(hex, "root"), bytes, network);
    assert.deepEqual(proof.decodeBytes32(base64, "root"), bytes, network);

    assert.throws(() => proof.decodeBytes32(bytes.slice(1), "root"), /exactly 32 bytes/, network);
    assert.throws(() => proof.decodeBytes32([...bytes.slice(1), 256], "root"), /unsigned byte/, network);
    assert.throws(() => proof.decodeBytes32("00".repeat(32), "root"), /canonical padded base64 or 0x hex/, network);
    assert.throws(() => proof.decodeBytes32(`${base64}=`, "root"), /canonical padded base64 or 0x hex/, network);
  }
});

test("proof decoding validates every hash and sibling direction", () => {
  for (const { network, proof } of proofModules()) {
    const hash = Array(32).fill(7);
    assert.deepEqual(
      proof.decodeProofNodes([{ hash, isRightSibling: false }], "subTreeProof"),
      [{ hash, isRightSibling: false }],
      network,
    );

    assert.throws(() => proof.decodeProofNodes({}, "subTreeProof"), /must be an array/, network);
    assert.throws(
      () => proof.decodeProofNodes([{ hash: hash.slice(1), isRightSibling: false }], "subTreeProof"),
      /exactly 32 bytes/,
      network,
    );
    assert.throws(
      () => proof.decodeProofNodes([{ hash, isRightSibling: 0 }], "subTreeProof"),
      /isRightSibling must be boolean/,
      network,
    );
  }
});

test("packed fixture IDs retain all 64 bits during unpacking", () => {
  for (const { network, proof } of proofModules()) {
    const unpacked = proof.unpackFixtureId("9223372036854788153");

    assert.equal(unpacked.packedId.toString(), "9223372036854788153", network);
    assert.equal(unpacked.fixtureId.toString(), "12345", network);
    assert.equal(unpacked.gameState, 32768, network);
  }
});

test("packed fixture IDs reject values that have already lost precision", () => {
  for (const { network, proof } of proofModules()) {
    assert.throws(
      () => proof.unpackFixtureId(9223372036854788000),
      /safe integer or a decimal string/,
      network,
    );
    assert.throws(() => proof.unpackFixtureId("-1"), /unsigned decimal integer/, network);
    assert.throws(
      () => proof.unpackFixtureId("18446744073709551616"),
      /unsigned 64-bit integer/,
      network,
    );
  }
});
