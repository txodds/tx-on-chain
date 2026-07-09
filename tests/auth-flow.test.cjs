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

const axios = require(path.join(root, "node_modules", "axios")).default;
const anchor = require(path.join(root, "node_modules", "@coral-xyz", "anchor"));
const nacl = require(path.join(root, "node_modules", "tweetnacl"));
const bs58Module = require(path.join(root, "node_modules", "bs58"));
const bs58 = bs58Module.default || bs58Module;
const config = require(path.join(root, "examples", "devnet", "common", "config.ts"));
const users = require(path.join(root, "examples", "devnet", "common", "users.ts"));

const originalPost = axios.post;
const originalAdapter = users.apiClient.defaults.adapter;

function resetAuth() {
  axios.post = originalPost;
  users.apiClient.defaults.adapter = originalAdapter;
  users.userAuthMap.clear();
  users.authState.apiToken = "";
  users.authState.jwt = "";
  delete process.env.TXLINE_TX_SIG;
}

function axiosFailure(status, requestConfig = {}) {
  const error = new Error(`HTTP ${status}`);
  error.isAxiosError = true;
  error.config = requestConfig;
  error.response = {
    status,
    statusText: String(status),
    data: "redacted",
    headers: {},
    config: requestConfig,
  };
  return error;
}

function response(config, data = { ok: true }) {
  return { status: 200, statusText: "OK", data, headers: {}, config };
}

function initialize(name, jwt = "initial.jwt", apiToken = "api-token-placeholder") {
  users.userAuthMap.set(name, { apiToken, jwt, refreshPromise: null, authGeneration: 0 });
  users.authState.apiToken = apiToken;
  users.authState.jwt = jwt;
}

test("authenticated client retries one 401 with the same API token and a fresh JWT", async (t) => {
  t.after(resetAuth);
  const name = "retry-user";
  initialize(name);
  let authCalls = 0;
  axios.post = async (url) => {
    assert.equal(url, config.JWT_URL);
    authCalls += 1;
    return { data: { token: "fresh.jwt" } };
  };
  let adapterCalls = 0;
  const seenApiTokens = [];
  const seenAuthorization = [];
  users.apiClient.defaults.adapter = async (requestConfig) => {
    adapterCalls += 1;
    seenApiTokens.push(requestConfig.headers.get("X-Api-Token"));
    seenAuthorization.push(requestConfig.headers.get("Authorization"));
    if (adapterCalls === 1) throw axiosFailure(401, requestConfig);
    return response(requestConfig);
  };

  const result = await users.apiClient.get("/test", { userName: name });
  assert.equal(result.status, 200);
  assert.equal(authCalls, 1);
  assert.equal(adapterCalls, 2);
  assert.deepEqual(seenApiTokens, ["api-token-placeholder", "api-token-placeholder"]);
  assert.deepEqual(seenAuthorization, ["Bearer initial.jwt", "Bearer fresh.jwt"]);
});

test("authenticated client treats 403 as terminal and never renews JWT", async (t) => {
  t.after(resetAuth);
  const name = "forbidden-user";
  initialize(name);
  let authCalls = 0;
  axios.post = async () => {
    authCalls += 1;
    throw new Error("must not be called");
  };
  let adapterCalls = 0;
  users.apiClient.defaults.adapter = async (requestConfig) => {
    adapterCalls += 1;
    throw axiosFailure(403, requestConfig);
  };

  await assert.rejects(
    users.apiClient.get("/test", { userName: name }),
    (error) => error.status === 403 && /JWT was not renewed/.test(error.message),
  );
  assert.equal(adapterCalls, 1);
  assert.equal(authCalls, 0);
});

test("concurrent 401 waiters share a failed renewal and all reject", async (t) => {
  t.after(resetAuth);
  const name = "concurrent-user";
  initialize(name);
  let authCalls = 0;
  axios.post = async () => {
    authCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw axiosFailure(503);
  };
  users.apiClient.defaults.adapter = async (requestConfig) => {
    throw axiosFailure(401, requestConfig);
  };

  const settled = await Promise.allSettled([
    users.apiClient.get("/one", { userName: name }),
    users.apiClient.get("/two", { userName: name }),
  ]);
  assert.equal(authCalls, 1);
  assert.deepEqual(settled.map((entry) => entry.status), ["rejected", "rejected"]);
});

test("a late 401 from an older auth generation retries without another renewal", async (t) => {
  t.after(resetAuth);
  const name = "late-user";
  initialize(name);
  let authCalls = 0;
  let renewalFinished;
  const renewed = new Promise((resolve) => { renewalFinished = resolve; });
  axios.post = async () => {
    authCalls += 1;
    renewalFinished();
    return { data: { token: "fresh.jwt" } };
  };
  const attempts = new Map();
  users.apiClient.defaults.adapter = async (requestConfig) => {
    const url = requestConfig.url;
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    if (count > 1) return response(requestConfig);
    if (url === "/late") await renewed;
    throw axiosFailure(401, requestConfig);
  };

  const [fast, late] = await Promise.all([
    users.apiClient.get("/fast", { userName: name }),
    users.apiClient.get("/late", { userName: name }),
  ]);
  assert.equal(fast.status, 200);
  assert.equal(late.status, 200);
  assert.equal(authCalls, 1);
  assert.equal(attempts.get("/fast"), 2);
  assert.equal(attempts.get("/late"), 2);
});

test("named requests never borrow missing credentials from global state", async (t) => {
  t.after(resetAuth);
  initialize("first-user", "first.jwt", "first-api-token");
  users.userAuthMap.set("second-user", {
    apiToken: "",
    jwt: "second.jwt",
    refreshPromise: null,
    authGeneration: 0,
  });
  let seenHeaders;
  users.apiClient.defaults.adapter = async (requestConfig) => {
    seenHeaders = requestConfig.headers;
    return response(requestConfig);
  };
  await users.apiClient.get("/second", { userName: "second-user" });
  assert.equal(seenHeaders.get("Authorization"), "Bearer second.jwt");
  assert.equal(seenHeaders.has("X-Api-Token"), false);
});

test("activation renews one 401, re-signs the JWT-bearing preimage, and emits 64-byte base64", async (t) => {
  t.after(resetAuth);
  const name = "activation-user";
  initialize(name);
  const user = anchor.web3.Keypair.generate();
  const txSig = bs58.encode(Buffer.alloc(64, 9));
  const activationRequests = [];
  let authCalls = 0;
  axios.post = async (url, body, requestConfig) => {
    if (url === config.JWT_URL) {
      authCalls += 1;
      return { data: { token: "fresh.jwt" } };
    }
    activationRequests.push({ body, requestConfig });
    if (activationRequests.length === 1) throw axiosFailure(401, requestConfig);
    return { data: "activated-api-token" };
  };

  const token = await users.activateSubscription({
    name,
    user,
    txSig,
    selectedLeagues: [],
    maxTransientRetries: 0,
  });
  assert.equal(token, "activated-api-token");
  assert.equal(authCalls, 1);
  assert.equal(activationRequests.length, 2);
  const [first, second] = activationRequests;
  const firstSignature = Buffer.from(first.body.walletSignature, "base64");
  const secondSignature = Buffer.from(second.body.walletSignature, "base64");
  assert.equal(firstSignature.length, 64);
  assert.equal(secondSignature.length, 64);
  assert.equal(
    nacl.sign.detached.verify(
      Buffer.from(`${txSig}::initial.jwt`, "utf8"),
      firstSignature,
      user.publicKey.toBytes(),
    ),
    true,
  );
  assert.equal(
    nacl.sign.detached.verify(
      Buffer.from(`${txSig}::fresh.jwt`, "utf8"),
      secondSignature,
      user.publicKey.toBytes(),
    ),
    true,
  );
  assert.equal(firstSignature.equals(secondSignature), false);
  assert.equal(first.requestConfig.headers.Authorization, "Bearer initial.jwt");
  assert.equal(second.requestConfig.headers.Authorization, "Bearer fresh.jwt");
});

test("activation never retries 403 and bounds a transient 504 retry", async (t) => {
  t.after(resetAuth);
  const name = "activation-bound-user";
  initialize(name);
  const user = anchor.web3.Keypair.generate();
  const txSig = bs58.encode(Buffer.alloc(64, 11));
  let calls = 0;
  axios.post = async (_url, _body, requestConfig) => {
    calls += 1;
    throw axiosFailure(403, requestConfig);
  };
  await assert.rejects(
    users.activateSubscription({ name, user, txSig, selectedLeagues: [] }),
    (error) => error.status === 403,
  );
  assert.equal(calls, 1);

  calls = 0;
  axios.post = async (_url, _body, requestConfig) => {
    calls += 1;
    if (calls === 1) throw axiosFailure(504, requestConfig);
    return { data: "activated-after-retry" };
  };
  const token = await users.activateSubscription({
    name,
    user,
    txSig,
    selectedLeagues: [],
    maxTransientRetries: 1,
    retryBaseDelayMs: 100,
  });
  assert.equal(token, "activated-after-retry");
  assert.equal(calls, 2);
});

test("activation rejects a non-64-byte base58 txSig before HTTP", async (t) => {
  t.after(resetAuth);
  const name = "invalid-signature-user";
  initialize(name);
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  await assert.rejects(users.activateSubscription({
    name,
    user: anchor.web3.Keypair.generate(),
    txSig: bs58.encode(Buffer.alloc(32, 5)),
    selectedLeagues: [],
  }), /64-byte/);
  assert.equal(calls, 0);
});
