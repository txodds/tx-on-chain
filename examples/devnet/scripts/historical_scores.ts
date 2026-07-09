// Discover an eligible final historical record and validate one stat from it.
// Optional overrides: TXLINE_FIXTURE_ID, TXLINE_SEQ, TXLINE_STAT_KEYS.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as users from "../common/users";
import {
  InconclusiveError,
  discoverScoreRecord,
  firstField,
  requiredSafeInteger,
  validateScoreOverrides,
} from "../common/flow";
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
  const name = "Historical final-record example";

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

  const selection = await discoverScoreRecord(users.apiClient, 1, { finalOnly: true });
  selection.statKeys = selection.statKeys.slice(0, 1);
  const rawStatusId = firstField(selection.record, ["statusId", "StatusId"]);
  if (rawStatusId === undefined) {
    throw new InconclusiveError(
      "An action=game_finalised record was found, but it did not expose statusId",
    );
  }
  const statusId = requiredSafeInteger(
    rawStatusId,
    "final record statusId/StatusId",
  );
  if (statusId !== 100) {
    throw new Error(
      `action=game_finalised record used unexpected statusId=${statusId}`,
    );
  }
  await validateV2Exact(userProgram, users.apiClient, selection, { expectedPeriod: 100 });
  console.log(
    `Final marker confirmed for fixture ${selection.fixtureId}, seq ${selection.seq}: `
    + "action=game_finalised, statusId=100, proof ScoreStat.period=100",
  );
}

main().then(
  () => process.exit(0),
  error => {
    if (error instanceof InconclusiveError) {
      console.error(`INCONCLUSIVE: ${error.message}`);
      process.exit(2);
    }
    console.error(error instanceof Error ? error.message : "Historical scores example failed");
    process.exit(1);
  },
);
