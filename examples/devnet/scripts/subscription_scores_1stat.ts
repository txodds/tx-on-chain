// Discover a current score record and validate one observed stat with validateStatV2.
// Optional reproducibility overrides: TXLINE_FIXTURE_ID, TXLINE_SEQ, TXLINE_STAT_KEYS.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as users from "../common/users";
import { discoverScoreRecord, validateScoreOverrides } from "../common/flow";
import { validateV2Exact } from "../common/score-validation";

async function main(): Promise<void> {
  validateScoreOverrides(1);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, provider);
  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set");
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET is not set");
  const name = "V2 one-stat example";

  const user = await users.setupUser(
    name,
    walletPath,
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

  const userProgram = new Program<Txoracle>(
    TxoracleJson as unknown as Txoracle,
    new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(user.user),
      anchor.AnchorProvider.defaultOptions(),
    ),
  );
  const selection = await discoverScoreRecord(users.apiClient, 1);
  selection.statKeys = selection.statKeys.slice(0, 1);
  await validateV2Exact(userProgram, users.apiClient, selection);
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : "One-stat V2 example failed");
    process.exit(1);
  },
);
