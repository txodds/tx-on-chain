import { expect } from "chai";
import { NETWORKS, idl, read } from "./helpers";
import { PROGRAM_ID, assertConsistent, renderTypes, trimIdl } from "../scripts/idl";

const INTENT_INSTRUCTIONS = ["create_intent", "close_intent", "execute_match"];
const names = (entries: any[] = []) => entries.map(e => e.name);

describe("published IDLs", () => {
  for (const network of NETWORKS) {
    describe(network, () => {
      it(`has the ${network} program address`, () => {
        expect(idl(network).address).to.equal(PROGRAM_ID[network]);
      });

      it("has nothing left for trim to remove", () => {
        expect(trimIdl(idl(network), network)).to.deep.equal(idl(network));
      });

      it("has no order intent instructions", () => {
        expect(names(idl(network).instructions)).to.not.include.members(INTENT_INSTRUCTIONS);
        expect(names(idl(network).accounts)).to.not.include("OrderIntent");
      });

      it("types/txoracle.ts is the camelCase form of the IDL", () => {
        expect(read(`examples/${network}/types/txoracle.ts`)).to.equal(renderTypes(idl(network)));
      });

      it("defines every type it refers to", () => {
        expect(() => assertConsistent(idl(network))).to.not.throw();
      });
    });
  }

  it("devnet keeps the faucet", () => {
    expect(names(idl("devnet").instructions)).to.include("request_devnet_faucet");
    expect(names(idl("devnet").accounts)).to.include("FaucetTracker");
  });

  it("mainnet has no faucet", () => {
    expect(names(idl("mainnet").instructions)).to.not.include("request_devnet_faucet");
    expect(names(idl("mainnet").accounts)).to.not.include("FaucetTracker");
  });

  it("the root idl/ and types/ are the mainnet copies", () => {
    expect(read("idl/txoracle.json")).to.equal(read("examples/mainnet/idl/txoracle.json"));
    expect(read("types/txoracle.ts")).to.equal(read("examples/mainnet/types/txoracle.ts"));
  });
});

describe("trimIdl", () => {
  // The devnet IDL with an order intent instruction and its account added back, as the devnet build has them
  function withIntents(): any {
    const source = JSON.parse(JSON.stringify(idl("devnet")));
    source.instructions.push({ name: "create_intent", discriminator: [1, 2, 3, 4, 5, 6, 7, 8], accounts: [], args: [] });
    source.accounts.push({ name: "OrderIntent", discriminator: [8, 7, 6, 5, 4, 3, 2, 1] });
    source.types.push({ name: "OrderIntent", type: { kind: "struct", fields: [{ name: "state", type: { defined: { name: "IntentState" } } }] } });
    source.types.push({ name: "IntentState", type: { kind: "enum", variants: [{ name: "Active" }] } });
    return source;
  }

  it("removes order intents for devnet and keeps the faucet", () => {
    const trimmed = trimIdl(withIntents(), "devnet");
    expect(trimmed).to.deep.equal(idl("devnet"));
  });

  it("removes order intents and the faucet for mainnet", () => {
    const source = { ...withIntents(), address: PROGRAM_ID.mainnet };
    const trimmed = trimIdl(source, "mainnet");
    expect(names(trimmed.instructions)).to.not.include.members(["create_intent", "request_devnet_faucet"]);
    expect(names(trimmed.accounts)).to.not.include.members(["OrderIntent", "FaucetTracker"]);
    expect(names(trimmed.types)).to.not.include.members(["OrderIntent", "IntentState", "FaucetTracker"]);
    expect(trimmed.instructions).to.have.length(idl("devnet").instructions.length - 1);
  });

  it("does not change its input", () => {
    const source = withIntents();
    const before = JSON.stringify(source);
    trimIdl(source, "devnet");
    expect(JSON.stringify(source)).to.equal(before);
  });

  // Bug: an IDL built with the wrong program keypair carried AFi29…, which is not deployed on devnet
  it("rejects a source built for another program address", () => {
    const source = { ...idl("devnet"), address: "AFi29Ewpg48hwuqmiWmyWvMvMMHn6bPKz2zeW7rLwcVK" };
    expect(() => trimIdl(source, "devnet")).to.throw(/not the devnet program/);
  });

  it("rejects a result that refers to a removed type", () => {
    const source = withIntents();
    source.instructions[0].args.push({ name: "intent", type: { defined: { name: "OrderIntent" } } });
    expect(() => trimIdl(source, "devnet")).to.throw(/undefined types: OrderIntent/);
  });
});
