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
const nacl = require(path.join(root, "node_modules", "tweetnacl"));
const devnet = require(path.join(root, "examples", "devnet", "common", "users.ts"));
const config = require(path.join(root, "examples", "devnet", "common", "config.ts"));
const mainnet = require(path.join(root, "examples", "mainnet", "common", "users.ts"));
const mainnetConfig = require(path.join(root, "examples", "mainnet", "common", "config.ts"));

const originalPost = axios.post;
const originalAdapter = devnet.apiClient.defaults.adapter;
const originalMainnetAdapter = mainnet.apiClient.defaults.adapter;

function reset() {
  axios.post = originalPost;
  devnet.apiClient.defaults.adapter = originalAdapter;
  mainnet.apiClient.defaults.adapter = originalMainnetAdapter;
  devnet.userAuthMap.clear();
  devnet.authState.jwt = "";
  devnet.authState.apiToken = "";
  mainnet.userAuthMap.clear();
  mainnet.authState.jwt = "";
  mainnet.authState.apiToken = "";
}

function initialize(name, jwt = "initial.jwt", apiToken = "api-token") {
  devnet.userAuthMap.set(name, {
    jwt,
    apiToken,
    refreshPromise: null,
    authGeneration: 0,
  });
  devnet.authState.jwt = jwt;
  devnet.authState.apiToken = apiToken;
}

function axiosFailure(status, requestConfig, code) {
  const error = new Error(`HTTP ${status}`);
  error.isAxiosError = true;
  error.config = requestConfig;
  error.code = code;
  error.response = { status, data: "SECRET_RESPONSE_BODY", config: requestConfig };
  return error;
}

function axiosResponse(requestConfig, data = { ok: true }) {
  return { status: 200, statusText: "OK", data, headers: {}, config: requestConfig };
}

test("401 refreshes once, retries once, and preserves the API token", async (t) => {
  t.after(reset);
  initialize("alice");
  let authCalls = 0;
  axios.post = async (url, body, options) => {
    assert.equal(url, config.JWT_URL);
    assert.equal(options.timeout, 10_000);
    authCalls++;
    return { data: { token: "fresh.jwt" } };
  };
  let calls = 0;
  const authHeaders = [];
  const apiTokens = [];
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    assert.equal(requestConfig.timeout, 15_000);
    authHeaders.push(requestConfig.headers.get("Authorization"));
    apiTokens.push(requestConfig.headers.get("X-Api-Token"));
    if (calls === 1) throw axiosFailure(401, requestConfig);
    return axiosResponse(requestConfig);
  };

  const result = await devnet.apiClient.get("/scores", { userName: "alice" });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.equal(authCalls, 1);
  assert.deepEqual(authHeaders, ["Bearer initial.jwt", "Bearer fresh.jwt"]);
  assert.deepEqual(apiTokens, ["api-token", "api-token"]);
});

test("mainnet auth client has the same 401 contract", async (t) => {
  t.after(reset);
  mainnet.userAuthMap.set("alice", {
    jwt: "initial.jwt",
    apiToken: "api-token",
    refreshPromise: null,
    authGeneration: 0,
  });
  mainnet.authState.jwt = "initial.jwt";
  mainnet.authState.apiToken = "api-token";
  let authCalls = 0;
  axios.post = async (url, body, options) => {
    assert.equal(url, mainnetConfig.JWT_URL);
    assert.equal(options.timeout, 10_000);
    authCalls++;
    return { data: { token: "fresh.jwt" } };
  };
  let calls = 0;
  mainnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    if (calls === 1) throw axiosFailure(401, requestConfig);
    return axiosResponse(requestConfig);
  };
  const result = await mainnet.apiClient.get("/scores", { userName: "alice" });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.equal(authCalls, 1);
});

test("403 is terminal and never renews or replays", async (t) => {
  t.after(reset);
  initialize("alice");
  let authCalls = 0;
  axios.post = async () => { authCalls++; throw new Error("unexpected refresh"); };
  let calls = 0;
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    throw axiosFailure(403, requestConfig);
  };
  await assert.rejects(devnet.apiClient.get("/scores", { userName: "alice" }), error => error.response?.status === 403);
  assert.equal(calls, 1);
  assert.equal(authCalls, 0);
});

test("concurrent 401 requests share a failed refresh and all reject", async (t) => {
  t.after(reset);
  initialize("alice");
  let authCalls = 0;
  axios.post = async () => {
    authCalls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    const error = new Error("JWT secret response");
    error.isAxiosError = true;
    error.code = "ECONNRESET";
    error.response = { status: 503, data: "SECRET_RESPONSE_BODY" };
    throw error;
  };
  let calls = 0;
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    throw axiosFailure(401, requestConfig);
  };
  const results = await Promise.allSettled([
    devnet.apiClient.get("/scores/a", { userName: "alice" }),
    devnet.apiClient.get("/scores/b", { userName: "alice" }),
  ]);
  assert.equal(authCalls, 1);
  assert.equal(calls, 2);
  assert.equal(results.every(result => result.status === "rejected"), true);
  assert.match(results[0].reason.message, /Guest JWT issuance failed/);
});

test("concurrent 401 requests share a successful refresh and each replay once", async (t) => {
  t.after(reset);
  initialize("alice");
  let authCalls = 0;
  axios.post = async () => {
    authCalls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { data: { token: "fresh.jwt" } };
  };
  let calls = 0;
  const seen = [];
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    seen.push(requestConfig.headers.get("Authorization"));
    if (calls <= 2) throw axiosFailure(401, requestConfig);
    return axiosResponse(requestConfig);
  };
  const results = await Promise.all([
    devnet.apiClient.get("/scores/a", { userName: "alice" }),
    devnet.apiClient.get("/scores/b", { userName: "alice" }),
  ]);
  assert.equal(results.length, 2);
  assert.equal(authCalls, 1);
  assert.equal(calls, 4);
  assert.deepEqual(seen.slice(0, 2), ["Bearer initial.jwt", "Bearer initial.jwt"]);
  assert.deepEqual(seen.slice(2), ["Bearer fresh.jwt", "Bearer fresh.jwt"]);
});

test("a named request never borrows global credentials", async (t) => {
  t.after(reset);
  devnet.authState.jwt = "global.jwt";
  devnet.authState.apiToken = "global-token";
  await assert.rejects(
    devnet.apiClient.get("/scores", { userName: "missing" }),
    /Authentication state for missing is not initialized/,
  );
});

test("a late 401 from an older auth generation replays without another refresh", async (t) => {
  t.after(reset);
  initialize("alice");
  let authCalls = 0;
  axios.post = async () => { authCalls++; return { data: { token: "unexpected.jwt" } }; };
  let calls = 0;
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    calls++;
    if (calls === 1) {
      const state = devnet.userAuthMap.get("alice");
      state.jwt = "already-fresh.jwt";
      state.authGeneration++;
      throw axiosFailure(401, requestConfig);
    }
    assert.equal(requestConfig.headers.get("Authorization"), "Bearer already-fresh.jwt");
    return axiosResponse(requestConfig);
  };
  await devnet.apiClient.get("/scores", { userName: "alice" });
  assert.equal(calls, 2);
  assert.equal(authCalls, 0);
});

test("unsafe credentials are rejected before the request is sent", async (t) => {
  t.after(reset);
  initialize("alice", "bad\ncredential", "api-token");
  let calls = 0;
  devnet.apiClient.defaults.adapter = async () => { calls++; return {}; };
  await assert.rejects(devnet.apiClient.get("/scores", { userName: "alice" }), /visible ASCII/);
  assert.equal(calls, 0);
});

test("invalid JWT issuance is rejected and does not overwrite existing state", async (t) => {
  t.after(reset);
  initialize("alice", "old.jwt", "api-token");
  axios.post = async () => ({ data: { token: "\u00a0" } });
  await assert.rejects(devnet.renewJwt("alice"), /Guest JWT issuance failed/);
  assert.equal(devnet.userAuthMap.get("alice").jwt, "old.jwt");
});

test("refresh logging omits credentials and response bodies", async (t) => {
  t.after(reset);
  initialize("alice");
  axios.post = async () => {
    const error = new Error("Bearer initial.jwt X-Api-Token SECRET_RESPONSE_BODY");
    error.isAxiosError = true;
    error.code = "ECONNRESET";
    error.response = { status: 503, data: "SECRET_RESPONSE_BODY" };
    throw error;
  };
  devnet.apiClient.defaults.adapter = async (requestConfig) => {
    throw axiosFailure(401, requestConfig);
  };
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    await assert.rejects(devnet.apiClient.get("/scores", { userName: "alice" }));
  } finally {
    console.error = originalError;
  }
  const output = logs.join("\n");
  assert.doesNotMatch(output, /initial\.jwt|api-token|SECRET_RESPONSE_BODY/);
  assert.match(output, /ECONNRESET|503/);
});

test("activation renews once and signs the fresh JWT preimage", async (t) => {
  t.after(reset);
  initialize("alice", "old.jwt", "");
  const user = require(path.join(root, "node_modules", "@coral-xyz", "anchor")).web3.Keypair.generate();
  const txSig = "5hQxTxSignature";
  const leagues = [1, 2];
  const requests = [];
  axios.post = async (url, body, options) => {
    requests.push({ url, body, options });
    if (url === config.JWT_URL) return { data: { token: "fresh.jwt" } };
    if (requests.filter(request => request.url !== config.JWT_URL).length === 1) {
      return Promise.reject(axiosFailure(401, options));
    }
    return { data: { token: "activated-token" } };
  };
  const token = await devnet.activateSubscription({ name: "alice", user, txSig, selectedLeagues: leagues });
  assert.equal(token, "activated-token");
  const activationRequests = requests.filter(request => request.url !== config.JWT_URL);
  assert.equal(activationRequests.length, 2);
  assert.equal(activationRequests[0].options.headers.Authorization, "Bearer old.jwt");
  assert.equal(activationRequests[1].options.headers.Authorization, "Bearer fresh.jwt");
  assert.equal(activationRequests[0].options.timeout, 15_000);
  assert.equal(activationRequests[1].options.timeout, 15_000);
  for (const request of activationRequests) {
    const preimage = `${txSig}:${leagues.join(",")}:${request.options.headers.Authorization.slice(7)}`;
    const signature = Buffer.from(request.body.walletSignature, "base64");
    assert.equal(signature.length, 64);
    assert.equal(nacl.sign.detached.verify(Buffer.from(preimage), signature, user.publicKey.toBytes()), true);
  }
  assert.notEqual(activationRequests[0].body.walletSignature, activationRequests[1].body.walletSignature);
});

test("activation treats 403 as terminal and does not refresh", async (t) => {
  t.after(reset);
  initialize("alice", "old.jwt", "");
  const user = require(path.join(root, "node_modules", "@coral-xyz", "anchor")).web3.Keypair.generate();
  let jwtCalls = 0;
  let activationCalls = 0;
  axios.post = async (url, body, options) => {
    if (url === config.JWT_URL) jwtCalls++;
    activationCalls++;
    return Promise.reject(axiosFailure(403, options));
  };
  await assert.rejects(
    devnet.activateSubscription({ name: "alice", user, txSig: "sig", selectedLeagues: [] }),
    error => error.status === 403 && !/SECRET_RESPONSE_BODY|Authorization/.test(error.message),
  );
  assert.equal(jwtCalls, 0);
  assert.equal(activationCalls, 1);
});

test("activation retries bounded 5xx failures and preserves state on invalid token", async (t) => {
  t.after(reset);
  initialize("alice", "old.jwt", "existing-token");
  const user = require(path.join(root, "node_modules", "@coral-xyz", "anchor")).web3.Keypair.generate();
  let calls = 0;
  axios.post = async (url, body, options) => {
    calls++;
    if (calls === 1) return Promise.reject(axiosFailure(503, options));
    return { data: { token: "\t" } };
  };
  await assert.rejects(
    devnet.activateSubscription({ name: "alice", user, txSig: "sig", selectedLeagues: [], maxTransientRetries: 1, retryBaseDelayMs: 0 }),
    error => error.name === "SafeHttpError" && !/SECRET_RESPONSE_BODY/.test(error.message),
  );
  assert.equal(calls, 2);
  assert.equal(devnet.userAuthMap.get("alice").apiToken, "existing-token");
});
