// Discover a current score record, validate one observed stat, and smoke-test scores SSE.
// Run from the project root. Optional reproducibility overrides:
// TXLINE_FIXTURE_ID, TXLINE_SEQ, TXLINE_STAT_KEYS, TXLINE_SSE_SECONDS (30..45).

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as os from "os";
import * as path from "path";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as config from "../common/config";
import * as users from "../common/users";
import {
  InconclusiveError,
  discoverScoreRecord,
  observeSse,
  sseDurationSeconds,
  summarizeSse,
  validateScoreOverrides,
} from "../common/flow";
import { validateLegacyExact } from "../common/score-validation";

async function main(): Promise<void> {
  validateScoreOverrides(1);
  const sseSeconds = sseDurationSeconds();
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, provider);

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set");
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET is not set");
  const keypairLocation = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : path.resolve(walletPath);
  const name = path.basename(walletPath, ".json");

  const user = await users.setupUser(
    name,
    keypairLocation,
    new PublicKey(mintAddress),
    provider.connection,
    program,
    1,
    4,
    [],
    process.env.TXLINE_GUEST_JWT,
    process.env.TXLINE_API_TOKEN,
  );
  console.log("Authentication established; credentials are redacted");

  const userProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(user.user),
    anchor.AnchorProvider.defaultOptions(),
  );
  const userProgram = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, userProvider);
  const selection = await discoverScoreRecord(users.apiClient, 1);
  await validateLegacyExact(userProgram, users.apiClient, selection);

  const observation = await observeSse({
    url: `${config.API_BASE_URL}/scores/stream?fixtureId=${selection.fixtureId}`,
    jwt: () => users.authState.jwt,
    apiToken: () => users.authState.apiToken,
    renewJwt: () => users.renewJwt(name),
    expectedFixtureId: selection.fixtureId,
    durationSeconds: sseSeconds,
  });
  summarizeSse("Scores SSE", observation);
}

main().then(
  () => process.exit(0),
  error => {
    if (error instanceof InconclusiveError) {
      console.error(`INCONCLUSIVE: ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "Scores example failed");
    process.exit(1);
  },
);
