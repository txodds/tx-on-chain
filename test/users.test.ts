import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { AxiosError } from "axios";
import { createHash } from "crypto";
import { Connection, Ed25519Program, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { NETWORKS, backendAdminKey, idl } from "./helpers";

// Ed25519Program.createInstructionWithPublicKey data layout: 16-byte header, then pubkey, signature, message
const ED25519_PUBKEY = [16, 48];
const ED25519_MESSAGE = [112, 144];

function offlineProgram(network: (typeof NETWORKS)[number]): anchor.Program<any> {
  const provider = new anchor.AnchorProvider(
    new Connection("http://127.0.0.1:1"),
    new anchor.Wallet(Keypair.generate()),
    {}
  );
  return new anchor.Program(idl(network), provider);
}

for (const network of NETWORKS) {
  const users = require(`../examples/${network}/common/users`);
  const program = offlineProgram(network);
  const adminKey = new PublicKey(backendAdminKey(network));

  describe(`${network} users.bookFixture`, () => {
    const wallet = Keypair.generate().publicKey;
    const fixtureId = 18241006;
    const originalGet = users.apiClient.get;

    let quoteRequests: number;
    let bookCalls: { payload: any; preInstructions: TransactionInstruction[] }[];
    let ticketExists: boolean;

    // A program bound to `wallet` that records book_fixture calls instead of sending them
    const fakeProgram = () => ({
      programId: program.programId,
      coder: program.coder,
      provider: {
        publicKey: wallet,
        connection: { getAccountInfo: async () => (ticketExists ? { data: Buffer.alloc(0) } : null) },
      },
      methods: {
        bookFixture: (payload: any) => {
          const call = { payload, preInstructions: [] as TransactionInstruction[] };
          bookCalls.push(call);
          const builder = {
            accounts: () => builder,
            preInstructions: (ixs: TransactionInstruction[]) => ((call.preInstructions = ixs), builder),
            rpc: async () => "test-signature",
          };
          return builder;
        },
      },
    });

    const stubQuote = (quoteFor: PublicKey) => {
      users.apiClient.get = async () => {
        quoteRequests++;
        return {
          data: {
            payload: { user: quoteFor.toBase58(), fixtureId, price: 250, ts: 1_700_000_000_000, validity: 1_700_000_060_000 },
            signature: Buffer.alloc(64, 7).toString("base64"),
          },
        };
      };
    };

    beforeEach(() => {
      quoteRequests = 0;
      bookCalls = [];
      ticketExists = false;
    });

    afterEach(() => {
      users.apiClient.get = originalGet;
    });

    it("skips the quote when the wallet already holds a fixture ticket", async () => {
      ticketExists = true;
      stubQuote(wallet);
      const result = await users.bookFixture(fakeProgram(), Keypair.generate().publicKey, fixtureId);
      expect(result).to.deep.equal({ status: "already-booked" });
      expect(quoteRequests).to.equal(0);
      expect(bookCalls).to.have.length(0);
    });

    it("returns no-quote on a 404 from the quote endpoint", async () => {
      users.apiClient.get = async () => {
        throw new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as any);
      };
      const result = await users.bookFixture(fakeProgram(), Keypair.generate().publicKey, fixtureId);
      expect(result).to.deep.equal({ status: "no-quote" });
      expect(bookCalls).to.have.length(0);
    });

    it("co-signs sha256(Borsh payload) with the network's backend admin key from the IDL", async () => {
      stubQuote(wallet);
      const result = await users.bookFixture(fakeProgram(), Keypair.generate().publicKey, fixtureId);
      expect(result).to.include({ status: "booked", price: 250 });

      const [{ payload, preInstructions }] = bookCalls;
      expect(preInstructions).to.have.length(1);
      const [ix] = preInstructions;
      expect(ix.programId.equals(Ed25519Program.programId)).to.equal(true);
      expect(Buffer.from(ix.data.subarray(...ED25519_PUBKEY)).equals(adminKey.toBuffer())).to.equal(true);
      const expectedMessage = createHash("sha256").update(program.coder.types.encode("bookFixturePayload", payload)).digest();
      expect(Buffer.from(ix.data.subarray(...ED25519_MESSAGE)).equals(expectedMessage)).to.equal(true);
    });

    // Bug: bookFixture pays whatever quote comes back without checking it was issued for the paying wallet
    it("refuses a quote issued for a different wallet", async () => {
      stubQuote(Keypair.generate().publicKey);
      let error: unknown;
      try {
        await users.bookFixture(fakeProgram(), Keypair.generate().publicKey, fixtureId);
      } catch (e) {
        error = e;
      }
      expect(bookCalls, "book_fixture must not be sent").to.have.length(0);
      expect(error, "bookFixture should reject the quote").to.be.instanceOf(Error);
    });
  });

  describe(`${network} users.verifyTransactionSafety`, () => {
    const buyer = Keypair.generate().publicKey;
    const amount = new anchor.BN(1_000_000);

    const purchaseTx = (cosigner: PublicKey, txlineAmount = amount) => {
      const tx = new Transaction();
      tx.feePayer = buyer;
      tx.add(
        new TransactionInstruction({
          programId: program.programId,
          keys: [{ pubkey: buyer, isSigner: true, isWritable: true }],
          data: program.coder.instruction.encode("purchaseSubscriptionTokenUsdt", { txlineAmount }),
        })
      );
      tx.signatures = [
        { publicKey: buyer, signature: null },
        { publicKey: cosigner, signature: Buffer.alloc(64, 1) },
      ];
      return tx;
    };

    it("accepts a purchase co-signed by the backend admin", () => {
      expect(() => users.verifyTransactionSafety(purchaseTx(adminKey), buyer, program, amount)).not.to.throw();
    });

    it("rejects an amount that differs from the one requested", () => {
      expect(() => users.verifyTransactionSafety(purchaseTx(adminKey, new anchor.BN(5)), buyer, program, amount))
        .to.throw(/Amount mismatch/);
    });

    // Bug: any non-buyer signature counts as the "backend admin signature"
    it("rejects a transaction co-signed by a key other than the backend admin", () => {
      const rogue = Keypair.generate().publicKey;
      expect(() => users.verifyTransactionSafety(purchaseTx(rogue), buyer, program, amount))
        .to.throw(/admin/i);
    });
  });

  describe(`${network} users.streamTtlMs`, () => {
    const original = process.env.STREAM_TTL_SECS;
    afterEach(() => {
      if (original === undefined) delete process.env.STREAM_TTL_SECS;
      else process.env.STREAM_TTL_SECS = original;
    });

    it("uses the script's default when STREAM_TTL_SECS is unset or empty", () => {
      delete process.env.STREAM_TTL_SECS;
      expect(users.streamTtlMs(3600)).to.equal(3_600_000);
      process.env.STREAM_TTL_SECS = "";
      expect(users.streamTtlMs(3600)).to.equal(3_600_000);
    });

    it("uses STREAM_TTL_SECS when set, including 0 and fractions", () => {
      process.env.STREAM_TTL_SECS = "30";
      expect(users.streamTtlMs(3600)).to.equal(30_000);
      process.env.STREAM_TTL_SECS = "0";
      expect(users.streamTtlMs(3600)).to.equal(0);
      process.env.STREAM_TTL_SECS = "1.5";
      expect(users.streamTtlMs(3600)).to.equal(1_500);
    });

    it("rejects a value that is not a non-negative number of seconds", () => {
      for (const bad of ["abc", "-5", "10s"]) {
        process.env.STREAM_TTL_SECS = bad;
        expect(() => users.streamTtlMs(3600)).to.throw(/STREAM_TTL_SECS/);
      }
    });
  });
}
