"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Readable } = require("node:stream");
const { createGunzip, gzipSync } = require("node:zlib");
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

const {
  decodeBytes32,
  decodeProofNodes,
} = require(path.join(root, "examples", "devnet", "common", "proof.ts"));
const {
  discoverScoreRecord,
  observeSse,
  parseSseFrame,
  requestedStatKeys,
  scoreIdentity,
  sseDurationSeconds,
  statKeysInRecord,
} = require(path.join(root, "examples", "devnet", "common", "flow.ts"));

function withEnv(values, callback) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.finally === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function installFetch(t, implementation) {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

function installClock(t) {
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  return {
    expire() {
      now = 31_000;
    },
  };
}

function headerSnapshot(headers) {
  return Object.fromEntries(Object.entries(headers));
}

function statusResponse(status, options = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: { cancel: async () => options.onCancel?.() },
  };
}

function sseResponse(chunks, options = {}) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;
  return {
    status: 200,
    ok: true,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/event-stream" : null;
      },
    },
    body: {
      cancel: async () => undefined,
      getReader() {
        return {
          async read() {
            if (index >= encoded.length) return { done: true, value: undefined };
            const value = encoded[index];
            index += 1;
            options.afterChunk?.(index);
            return { done: false, value };
          },
          cancel: async () => undefined,
        };
      },
    },
  };
}

test("decodeBytes32 accepts each supported canonical representation", () => {
  const bytes = Array.from({ length: 32 }, (_, index) => index);
  const base64 = Buffer.from(bytes).toString("base64");
  const hex = `0x${Buffer.from(bytes).toString("hex")}`;
  assert.deepEqual(decodeBytes32(bytes), bytes);
  assert.deepEqual(decodeBytes32(Uint8Array.from(bytes)), bytes);
  assert.deepEqual(decodeBytes32(Buffer.from(bytes)), bytes);
  assert.deepEqual(decodeBytes32(base64), bytes);
  assert.deepEqual(decodeBytes32(hex), bytes);
});

test("decodeBytes32 rejects invalid length, byte range, alphabet, and ambiguous strings", () => {
  const valid = Buffer.alloc(32, 7).toString("base64");
  const invalid = [
    Array(31).fill(0),
    Array(33).fill(0),
    [...Array(31).fill(0), -1],
    [...Array(31).fill(0), 256],
    [...Array(31).fill(0), 1.5],
    valid.slice(0, -1),
    `${valid.slice(0, -2)}*=`,
    Buffer.alloc(32, 7).toString("hex"),
    "0x00",
  ];
  invalid.forEach((value) => assert.throws(() => decodeBytes32(value)));
  assert.throws(() => decodeBytes32(new Array(32)));
});

test("decodeProofNodes validates hash shape and sibling direction", () => {
  const hash = Buffer.alloc(32, 3).toString("base64");
  assert.deepEqual(decodeProofNodes([{ hash, isRightSibling: true }]), [{
    hash: Array(32).fill(3),
    isRightSibling: true,
  }]);
  assert.throws(() => decodeProofNodes([{ hash, isRightSibling: "true" }]));
});

test("score identity and stat discovery normalize casing and numeric-key maps", () => {
  assert.deepEqual(scoreIdentity({ FixtureId: 7, Seq: 9, Ts: 1_800_000_000_000 }), {
    fixtureId: 7,
    seq: 9,
    ts: 1_800_000_000_000,
  });
  assert.deepEqual(scoreIdentity({ fixtureId: "7", seq: "9", ts: "1800000000000" }), {
    fixtureId: 7,
    seq: 9,
    ts: 1_800_000_000_000,
  });
  assert.deepEqual(
    statKeysInRecord({ stats: { 1: 2, 3001: 4 }, statList: [{ Key: 2, Value: 5 }] }).sort((a, b) => a - b),
    [1, 2, 3001],
  );
  assert.deepEqual(statKeysInRecord({
    FixtureId: 7,
    Seq: 9,
    Ts: 1_800_000_000_000,
    Key: 44,
    Value: 3,
  }), [44]);
  assert.deepEqual(statKeysInRecord({ metadata: { Key: 99, Value: 1 } }), []);
});

test("TXLINE_STAT_KEYS preserves order and rejects invalid u32 lists", () => {
  withEnv({ TXLINE_STAT_KEYS: "2,1" }, () => assert.deepEqual(requestedStatKeys(), [2, 1]));
  withEnv({ TXLINE_STAT_KEYS: "1,1" }, () => assert.throws(() => requestedStatKeys()));
  withEnv({ TXLINE_STAT_KEYS: "1,,2" }, () => assert.throws(() => requestedStatKeys()));
  withEnv({ TXLINE_STAT_KEYS: "-1" }, () => assert.throws(() => requestedStatKeys()));
  withEnv({ TXLINE_STAT_KEYS: "4294967296" }, () => assert.throws(() => requestedStatKeys()));
});

test("dynamic discovery returns an observed record and preserves requested reversed order", async () => {
  const record = {
    fixtureId: 42,
    seq: 3,
    ts: 1_800_000_000_000,
    stats: { 1: 10, 2: 20, 3001: 30 },
  };
  const client = {
    async get(url) {
      return { status: 200, data: url.includes("/scores/updates/") ? [record] : [] };
    },
  };
  await withEnv({
    TXLINE_FIXTURE_ID: undefined,
    TXLINE_SEQ: undefined,
    TXLINE_STAT_KEYS: "2,1",
  }, async () => {
    const selection = await discoverScoreRecord(client, 2);
    assert.equal(selection.fixtureId, 42);
    assert.equal(selection.seq, 3);
    assert.deepEqual(selection.statKeys, [2, 1]);
  });
});

test("paired fixture/sequence overrides fail closed", async () => {
  await withEnv({ TXLINE_FIXTURE_ID: "42", TXLINE_SEQ: undefined }, async () => {
    await assert.rejects(discoverScoreRecord({ get: async () => ({ status: 200, data: [] }) }, 1));
  });
});

test("final-record discovery uses an eligible fixture from the historical retention window", async () => {
  const fixture = {
    FixtureId: 77,
    StartTime: Date.now() - 7 * 86_400_000,
  };
  const finalRecord = {
    fixtureId: 77,
    seq: 4,
    ts: 1_800_000_000_000,
    action: "game_finalised",
    statusId: 100,
    stats: { 1: 2 },
  };
  const client = {
    async get(url) {
      if (url.startsWith("/fixtures/snapshot")) return { status: 200, data: [fixture] };
      if (url === "/scores/historical/77") return { status: 200, data: [finalRecord] };
      return { status: 200, data: [] };
    },
  };
  await withEnv({
    TXLINE_FIXTURE_ID: undefined,
    TXLINE_SEQ: undefined,
    TXLINE_STAT_KEYS: undefined,
  }, async () => {
    const selection = await discoverScoreRecord(client, 1, { finalOnly: true });
    assert.equal(selection.fixtureId, 77);
    assert.equal(selection.seq, 4);
    assert.deepEqual(selection.statKeys, [1]);
  });
});

test("SSE duration is bounded to 30 through 45 seconds", () => {
  withEnv({ TXLINE_SSE_SECONDS: "30" }, () => assert.equal(sseDurationSeconds(), 30));
  withEnv({ TXLINE_SSE_SECONDS: "45" }, () => assert.equal(sseDurationSeconds(), 45));
  withEnv({ TXLINE_SSE_SECONDS: "29" }, () => assert.throws(() => sseDurationSeconds()));
  withEnv({ TXLINE_SSE_SECONDS: "46" }, () => assert.throws(() => sseDurationSeconds()));
});

test("SSE parser distinguishes heartbeat, data, and resume ID across frame boundaries", () => {
  const state = { heartbeatCount: 0, dataCount: 0 };
  const chunks = [": heart", "beat\n\nid: 17\nev", "ent: score\ndata: {\"ok\":true}\n\n"];
  let buffer = "";
  for (const chunk of chunks) {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      parseSseFrame(buffer.slice(0, boundary), state);
      buffer = buffer.slice(boundary + 2);
    }
  }
  assert.deepEqual(state, { heartbeatCount: 1, dataCount: 1, lastEventId: "17" });
  parseSseFrame("event: heartbeat", state);
  assert.equal(state.heartbeatCount, 2);
  parseSseFrame("id:", state);
  assert.equal(state.lastEventId, undefined);
});

test("observeSse renews one 401 with a fresh JWT and the same API token", async (t) => {
  const clock = installClock(t);
  let jwt = "expired.jwt";
  let renewals = 0;
  let cancellations = 0;
  const requests = [];
  installFetch(t, async (_url, init) => {
    requests.push(headerSnapshot(init.headers));
    if (requests.length === 1) {
      return statusResponse(401, { onCancel: () => { cancellations += 1; } });
    }
    return sseResponse(["data: {\"ok\":true}\n\n"], { afterChunk: () => clock.expire() });
  });

  const observation = await observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => jwt,
    apiToken: () => "stable-api-token",
    renewJwt: async () => {
      renewals += 1;
      jwt = "fresh.jwt";
      return jwt;
    },
    durationSeconds: 30,
  });

  assert.equal(observation.outcome, "data");
  assert.equal(renewals, 1);
  assert.equal(cancellations, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((headers) => headers.Authorization), [
    "Bearer expired.jwt",
    "Bearer fresh.jwt",
  ]);
  assert.deepEqual(requests.map((headers) => headers["X-Api-Token"]), [
    "stable-api-token",
    "stable-api-token",
  ]);
});

test("observeSse fails after one JWT renewal when 401 persists", async (t) => {
  let jwt = "expired.jwt";
  let renewals = 0;
  let cancellations = 0;
  const requests = [];
  installFetch(t, async (_url, init) => {
    requests.push(headerSnapshot(init.headers));
    return statusResponse(401, { onCancel: () => { cancellations += 1; } });
  });

  await assert.rejects(observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => jwt,
    apiToken: () => "stable-api-token",
    renewJwt: async () => {
      renewals += 1;
      jwt = "fresh.jwt";
      return jwt;
    },
    durationSeconds: 30,
  }), /after one bounded JWT renewal/);

  assert.equal(renewals, 1);
  assert.equal(cancellations, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((headers) => headers["X-Api-Token"]), [
    "stable-api-token",
    "stable-api-token",
  ]);
});

test("observeSse treats persistent 403 as terminal without renewal or reconnect", async (t) => {
  let renewals = 0;
  let requests = 0;
  let cancellations = 0;
  installFetch(t, async () => {
    requests += 1;
    return statusResponse(403, { onCancel: () => { cancellations += 1; } });
  });

  await assert.rejects(observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => "valid.jwt",
    apiToken: () => "invalid-api-token",
    renewJwt: async () => {
      renewals += 1;
      return "must-not-be-used.jwt";
    },
    durationSeconds: 30,
  }), /verify API token, subscription, and bundle entitlement/);

  assert.equal(requests, 1);
  assert.equal(renewals, 0);
  assert.equal(cancellations, 1);
});

test("observeSse gives real data precedence over a comment in the same frame", async (t) => {
  const clock = installClock(t);
  installFetch(t, async () => sseResponse([
    ": keepalive\nevent: score\ndata: {\"fixtureId\":42}\n\n",
  ], { afterChunk: () => clock.expire() }));

  const observation = await observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => "valid.jwt",
    apiToken: () => "valid-api-token",
    renewJwt: async () => "must-not-be-used.jwt",
    durationSeconds: 30,
  });

  assert.equal(observation.outcome, "data");
  assert.equal(observation.dataCount, 1);
  assert.equal(observation.heartbeatCount, 0);
});

test("observeSse reports an accepted heartbeat-only stream as inconclusive", async (t) => {
  const clock = installClock(t);
  installFetch(t, async () => sseResponse([
    ": heartbeat\n\n",
  ], { afterChunk: () => clock.expire() }));

  const observation = await observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => "valid.jwt",
    apiToken: () => "valid-api-token",
    renewJwt: async () => "must-not-be-used.jwt",
    durationSeconds: 30,
  });

  assert.deepEqual(observation, {
    outcome: "inconclusive",
    opened: true,
    heartbeatCount: 1,
    dataCount: 0,
    lastEventId: undefined,
  });
});

test("observeSse reconnects once with the last event ID from the first stream", async (t) => {
  const clock = installClock(t);
  const requests = [];
  installFetch(t, async (_url, init) => {
    requests.push(headerSnapshot(init.headers));
    if (requests.length === 1) {
      return sseResponse(["id: event-17\ndata: {\"seq\":17}\n\n"]);
    }
    return sseResponse([": heartbeat\n\n"], { afterChunk: () => clock.expire() });
  });

  const observation = await observeSse({
    url: "https://example.invalid/scores/stream",
    jwt: () => "valid.jwt",
    apiToken: () => "valid-api-token",
    renewJwt: async () => "must-not-be-used.jwt",
    durationSeconds: 30,
    initialLastEventId: "seed-event",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]["Last-Event-ID"], "seed-event");
  assert.equal(requests[1]["Last-Event-ID"], "event-17");
  assert.equal(observation.outcome, "data");
  assert.equal(observation.dataCount, 1);
  assert.equal(observation.heartbeatCount, 1);
  assert.equal(observation.lastEventId, "event-17");
});

test("native fetch decodes a split gzip SSE response without manual decompression", async () => {
  const body = ": heartbeat\n\nid: 21\ndata: {\"ok\":true}\n\n";
  const compressed = gzipSync(body);
  let negotiatedEncoding = "";
  const server = http.createServer((request, response) => {
    negotiatedEncoding = request.headers["accept-encoding"] || "";
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Content-Encoding": "gzip",
    });
    response.write(compressed.subarray(0, 7));
    response.write(compressed.subarray(7, 19));
    response.end(compressed.subarray(19));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/sse`);
    assert.equal(await response.text(), body);
    assert.match(negotiatedEncoding, /gzip/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a streaming gunzip pipeline tolerates a gzip frame split across chunks", async () => {
  const body = "data: split-frame\n\n";
  const compressed = gzipSync(body);
  const gunzip = createGunzip();
  const output = [];
  gunzip.on("data", (chunk) => output.push(chunk));
  const complete = new Promise((resolve, reject) => {
    gunzip.on("end", resolve);
    gunzip.on("error", reject);
  });
  Readable.from([
    compressed.subarray(0, 3),
    compressed.subarray(3, 11),
    compressed.subarray(11),
  ]).pipe(gunzip);
  await complete;
  assert.equal(Buffer.concat(output).toString("utf8"), body);
});
