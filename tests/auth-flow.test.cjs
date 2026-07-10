"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
const splToken = require(path.join(root, "node_modules", "@solana", "spl-token"));
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
  delete process.env.TXLINE_RECOVERY_FILE;
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

function signedSubscriptionTransaction() {
  const payer = anchor.web3.Keypair.generate();
  const latestBlockhash = {
    blockhash: anchor.web3.Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
  };
  const tx = new anchor.web3.Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(anchor.web3.SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports: 0,
  }));
  tx.sign(payer);
  return { tx, latestBlockhash, txSig: bs58.encode(tx.signature) };
}

function subscriptionHarness(wallet, tokenMint, overrides = {}) {
  const programId = overrides.programId || anchor.web3.Keypair.generate().publicKey;
  const genesisHash = overrides.genesisHash || anchor.web3.Keypair.generate().publicKey.toBase58();
  const latestBlockhash = {
    blockhash: anchor.web3.Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 500,
  };
  const tokenData = Buffer.alloc(splToken.AccountLayout.span);
  splToken.AccountLayout.encode({
    mint: tokenMint,
    owner: wallet.publicKey,
    amount: 1_000n,
    delegateOption: 0,
    delegate: anchor.web3.PublicKey.default,
    state: splToken.AccountState.Initialized,
    isNativeOption: 0,
    isNative: 0n,
    delegatedAmount: 0n,
    closeAuthorityOption: 0,
    closeAuthority: anchor.web3.PublicKey.default,
  }, tokenData);
  const accountInfo = {
    data: tokenData,
    executable: false,
    lamports: 1,
    owner: splToken.TOKEN_2022_PROGRAM_ID,
    rentEpoch: 0,
  };
  let prepareCalls = 0;
  const program = {
    programId,
    account: {
      pricingMatrix: {
        async fetch() {
          return {
            admin: anchor.web3.Keypair.generate().publicKey,
            rows: [{
              rowId: 1,
              pricePerWeekToken: 1,
              samplingIntervalSec: 1,
              leagueBundleId: 1,
              marketBundleId: 1,
            }],
          };
        },
      },
    },
    methods: {
      subscribe() {
        prepareCalls += 1;
        return {
          accounts() {
            return {
              async transaction() {
                return new anchor.web3.Transaction().add(
                  anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
                );
              },
            };
          },
        };
      },
    },
  };
  const connection = {
    async getGenesisHash() { return genesisHash; },
    async getAccountInfo() { return accountInfo; },
    async getLatestBlockhash() { return latestBlockhash; },
    async sendRawTransaction(serialized) {
      return overrides.sendRawTransaction(serialized);
    },
    async confirmTransaction(strategy, commitment) {
      return overrides.confirmTransaction(strategy, commitment);
    },
    async getSignatureStatuses(signatures, options) {
      return overrides.getSignatureStatuses(signatures, options);
    },
  };
  return { connection, program, get prepareCalls() { return prepareCalls; } };
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

test("subscription submission surfaces its signature when broadcast outcome is ambiguous", async () => {
  const { tx, latestBlockhash, txSig } = signedSubscriptionTransaction();
  let confirmations = 0;
  const connection = {
    async sendRawTransaction() {
      throw new Error("RPC response lost");
    },
    async confirmTransaction() {
      confirmations += 1;
      throw new Error("must not be called");
    },
  };

  await assert.rejects(
    users.broadcastAndConfirmSubscription(connection, tx, latestBlockhash, "ambiguous-user"),
    (error) => error instanceof users.SubscriptionSubmissionError
      && error.phase === "broadcast"
      && error.txSig === txSig,
  );
  assert.equal(confirmations, 0);
});

test("subscription submission never hides a signature behind a confirmation timeout", async () => {
  const { tx, latestBlockhash, txSig } = signedSubscriptionTransaction();
  const connection = {
    async sendRawTransaction() {
      return txSig;
    },
    async confirmTransaction() {
      throw new Error("confirmation timeout");
    },
  };

  await assert.rejects(
    users.broadcastAndConfirmSubscription(connection, tx, latestBlockhash, "timeout-user"),
    (error) => error instanceof users.SubscriptionSubmissionError
      && error.phase === "confirmation"
      && error.txSig === txSig,
  );
});

test("header-unsafe credentials are rejected without replacing recoverable state", async (t) => {
  t.after(resetAuth);
  const name = "unsafe-credential-user";
  initialize(name, "initial.jwt", "existing-api-token");
  const userState = users.userAuthMap.get(name);
  const txSig = bs58.encode(Buffer.alloc(64, 13));
  userState.confirmedTxSig = txSig;
  axios.post = async () => ({ data: "  \t" });

  await assert.rejects(users.activateSubscription({
    name,
    user: anchor.web3.Keypair.generate(),
    txSig,
    selectedLeagues: [],
    maxTransientRetries: 0,
  }));
  assert.equal(userState.apiToken, "existing-api-token");
  assert.equal(userState.confirmedTxSig, txSig);

  axios.post = async () => ({ data: "api\u00a0token" });
  await assert.rejects(users.activateSubscription({
    name,
    user: anchor.web3.Keypair.generate(),
    txSig,
    selectedLeagues: [],
    maxTransientRetries: 0,
  }));
  assert.equal(userState.apiToken, "existing-api-token");
  assert.equal(userState.confirmedTxSig, txSig);

  axios.post = async () => ({ data: { token: "invalid\r\njwt" } });
  await assert.rejects(users.renewJwt(name));
  assert.equal(userState.jwt, "initial.jwt");
});

test("durable subscription recovery prevents a resubmit after state restart", async (t) => {
  t.after(resetAuth);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "txline-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wallet = anchor.web3.Keypair.generate();
  const walletPath = path.join(directory, "wallet.json");
  const recoveryPath = path.join(directory, "subscription-recovery.json");
  fs.writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)));
  process.env.TXLINE_RECOVERY_FILE = recoveryPath;

  const tokenMint = anchor.web3.Keypair.generate().publicKey;
  const programId = anchor.web3.Keypair.generate().publicKey;
  const genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  let sendCalls = 0;
  let txSig;
  const first = subscriptionHarness(wallet, tokenMint, {
    programId,
    genesisHash,
    async sendRawTransaction(serialized) {
      sendCalls += 1;
      assert.equal(fs.existsSync(recoveryPath), true, "WAL must exist before broadcast");
      txSig = bs58.encode(anchor.web3.Transaction.from(serialized).signature);
      throw new Error("accepted response was lost");
    },
    async confirmTransaction() { throw new Error("must not confirm after broadcast timeout"); },
    async getSignatureStatuses() { throw new Error("must not query during initial submit"); },
  });

  await assert.rejects(
    users.setupUser(
      "wal-user", walletPath, tokenMint, first.connection, first.program,
      1, 4, [], "restart.jwt",
    ),
    (error) => error instanceof users.SubscriptionSubmissionError && error.txSig === txSig,
  );
  assert.equal(sendCalls, 1);
  assert.equal(first.prepareCalls, 1);
  const record = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  assert.deepEqual(Object.keys(record).sort(), [
    "apiBaseUrl", "createdAt", "genesisHash", "lastValidBlockHeight", "programId",
    "recentBlockhash", "schema", "selectedLeagues", "serviceLevelId", "source",
    "tokenMint", "txSig", "wallet", "weeks",
  ]);
  assert.equal(record.txSig, txSig);
  assert.equal(record.wallet, wallet.publicKey.toBase58());
  assert.equal(JSON.stringify(record).includes("restart.jwt"), false);

  const mismatched = subscriptionHarness(wallet, tokenMint, {
    programId: anchor.web3.Keypair.generate().publicKey,
    genesisHash,
    async sendRawTransaction() { throw new Error("context mismatch must not broadcast"); },
    async confirmTransaction() { throw new Error("context mismatch must not confirm"); },
    async getSignatureStatuses() { throw new Error("context mismatch must fail before status"); },
  });
  await assert.rejects(users.setupUser(
    "wal-user", walletPath, tokenMint, mismatched.connection, mismatched.program,
    1, 4, [], "restart.jwt",
  ), /does not match.*programId/);
  assert.equal(mismatched.prepareCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(fs.existsSync(recoveryPath), true);

  users.userAuthMap.clear();
  users.authState.apiToken = "";
  users.authState.jwt = "";
  const pending = subscriptionHarness(wallet, tokenMint, {
    programId,
    genesisHash,
    async sendRawTransaction() { throw new Error("pending recovery must not broadcast"); },
    async confirmTransaction() { throw new Error("pending recovery must not confirm"); },
    async getSignatureStatuses() {
      return {
        context: { slot: 9 },
        value: [{ slot: 9, confirmations: 0, err: null, confirmationStatus: "processed" }],
      };
    },
  });
  await assert.rejects(users.setupUser(
    "wal-user", walletPath, tokenMint, pending.connection, pending.program,
    1, 4, [], "restart.jwt",
  ), /only processed, not confirmed/);
  assert.equal(pending.prepareCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(fs.existsSync(recoveryPath), true);

  users.userAuthMap.clear();
  users.authState.apiToken = "";
  users.authState.jwt = "";
  let statusCalls = 0;
  const second = subscriptionHarness(wallet, tokenMint, {
    programId,
    genesisHash,
    async sendRawTransaction() {
      sendCalls += 1;
      throw new Error("recovery must not broadcast");
    },
    async confirmTransaction() { throw new Error("recovery must not confirm a new tx"); },
    async getSignatureStatuses(signatures, options) {
      statusCalls += 1;
      assert.deepEqual(signatures, [txSig]);
      assert.equal(options.searchTransactionHistory, true);
      return {
        context: { slot: 10 },
        value: [{ slot: 10, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
      };
    },
  });
  axios.post = async () => ({ data: "recovered-api-token" });
  const recovered = await users.setupUser(
    "wal-user", walletPath, tokenMint, second.connection, second.program,
    1, 4, [], "restart.jwt",
  );
  assert.equal(recovered.txSig, txSig);
  assert.equal(recovered.activationStatus, "activated");
  assert.equal(statusCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(second.prepareCalls, 0);
  assert.equal(fs.existsSync(recoveryPath), true, "confirmed WAL becomes a durable tombstone");

  users.userAuthMap.clear();
  users.authState.apiToken = "";
  users.authState.jwt = "";
  const third = subscriptionHarness(wallet, tokenMint, {
    programId,
    genesisHash,
    async sendRawTransaction() {
      sendCalls += 1;
      throw new Error("post-activation restart must not broadcast");
    },
    async confirmTransaction() { throw new Error("post-activation restart must not confirm"); },
    async getSignatureStatuses() {
      return {
        context: { slot: 11 },
        value: [{ slot: 11, confirmations: null, err: null, confirmationStatus: "finalized" }],
      };
    },
  });
  axios.post = async () => ({ data: "reactivated-api-token" });
  const reactivated = await users.setupUser(
    "wal-user", walletPath, tokenMint, third.connection, third.program,
    1, 4, [], "restart.jwt",
  );
  assert.equal(reactivated.txSig, txSig);
  assert.equal(third.prepareCalls, 0);
  assert.equal(sendCalls, 1);
  assert.equal(fs.existsSync(recoveryPath), true);
});

test("setup rejects whitespace-padded recovery signatures before RPC", async (t) => {
  t.after(resetAuth);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "txline-signature-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wallet = anchor.web3.Keypair.generate();
  const walletPath = path.join(directory, "wallet.json");
  fs.writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)));
  process.env.TXLINE_RECOVERY_FILE = path.join(directory, "recovery.json");
  let genesisCalls = 0;
  const connection = {
    async getGenesisHash() { genesisCalls += 1; throw new Error("must not be called"); },
  };
  const signature = bs58.encode(Buffer.alloc(64, 21));
  await assert.rejects(users.setupUser(
    "raw-signature-user",
    walletPath,
    anchor.web3.Keypair.generate().publicKey,
    connection,
    { programId: anchor.web3.Keypair.generate().publicKey },
    1,
    4,
    [],
    "restart.jwt",
    undefined,
    ` ${signature}`,
  ), /valid base58|canonical base58/);
  assert.equal(genesisCalls, 0);
  assert.equal(fs.existsSync(process.env.TXLINE_RECOVERY_FILE), false);
});
