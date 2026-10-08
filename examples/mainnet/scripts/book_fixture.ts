// Demonstrate booking a fixture: GET /api/fixtures-schedule -> GET /api/quotes/book-fixture -> book_fixture
// A booking grants unlimited V4 validations and data access for that one fixture (no subscription bundle needed)

// Run with
// TOKEN_MINT_ADDRESS=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL ANCHOR_PROVIDER_URL="https://api.mainnet-beta.solana.com" ANCHOR_WALLET="./_keys/mainnet-testuser-wallet-1.json" ts-node examples/mainnet/scripts/book_fixture.ts
// Optionally pin the fixture with FIXTURE_ID; otherwise the first bookable fixture in the schedule is used

import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { Txoracle } from "../types/txoracle";
import TxoracleJson from "../idl/txoracle.json";
import * as users from "../common/users";
import axios from "axios";
import { PublicKey } from "@solana/web3.js";

interface ScheduleFixture {
  FixtureId: number
  CompetitionId: number
  Participant1: string
  Participant2: string
  StartTime: number
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program<Txoracle>(TxoracleJson as unknown as Txoracle, provider);
  const connection = provider.connection;

  const mintAddress = process.env.TOKEN_MINT_ADDRESS;
  if (!mintAddress) throw new Error("TOKEN_MINT_ADDRESS is not set!");
  const tokenMint = new PublicKey(mintAddress);

  const name = "Trader A";
  const user = await users.setupUser(name, process.env.ANCHOR_WALLET!, tokenMint, connection, program, 1, 4, []);

  const userProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(user.user), anchor.AnchorProvider.defaultOptions());
  const userProgram = new anchor.Program<Txoracle>(program.idl as Txoracle, userProvider);

  try {
    // afterTs defaults to now and is limited to the last two weeks
    const schedule = (await users.apiClient.get<ScheduleFixture[]>("/fixtures-schedule", { userName: name } as any)).data;
    console.log(`Bookable fixtures: ${schedule.length}`);
    schedule.slice(0, 10).forEach(f =>
      console.log(`  ${f.FixtureId}  competition ${f.CompetitionId}  ${f.Participant1} v ${f.Participant2}  ${new Date(f.StartTime).toISOString()}`)
    );

    const fixtureId = process.env.FIXTURE_ID ? Number(process.env.FIXTURE_ID) : schedule[0]?.FixtureId;
    if (fixtureId === undefined) throw new Error("No bookable fixtures in the schedule; set FIXTURE_ID");

    console.log(`Booking fixture ${fixtureId}`);
    const result = await users.bookFixture(userProgram, tokenMint, fixtureId, name);

    switch (result.status) {
      case "no-quote":
        console.error(`No quote for fixture ${fixtureId} (404): it lacks odds and scores, or its competition has no price`);
        process.exit(1);
      case "already-booked":
        console.log(`Fixture ${fixtureId} is already booked by this wallet; a repeat booking would fail with FixtureAlreadyBooked`);
        break;
      case "booked":
        console.log(result.price === 0
          ? "Booked at price 0, no TxL transferred"
          : `Booked for ${result.price} TxL base units`);
        console.log(`Signature: ${result.signature}`);
        break;
    }

    const ticket = await userProgram.account.fixtureTicket.fetch(
      users.fixtureTicketPda(userProgram.programId, userProvider.publicKey, fixtureId)
    );
    console.log(`Fixture ticket: owner ${ticket.owner.toBase58()}, fixture ${ticket.fixtureId}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request Failed:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }
}

main().then(() => process.exit(0));
