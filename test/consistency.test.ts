import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { NETWORKS, ROOT, idl, read } from "./helpers";

function docFiles(): string[] {
  const out: string[] = ["README.md", "llms.txt"];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (rel.endsWith(".mdx")) out.push(rel);
    }
  };
  walk("documentation");
  return out;
}

function scriptsDir(network: string) {
  return path.join(ROOT, "examples", network, "scripts");
}

describe("docs reference code that exists", () => {
  // Bug: booking-fixtures.mdx says the examples keep `BACKEND_ADMIN_PUBKEY` in config.ts, which this PR removed
  it("every `NAME` in `examples/...ts` mention is exported by that file", () => {
    const missing: string[] = [];
    for (const doc of docFiles()) {
      for (const [, name, file] of read(doc).matchAll(/`([A-Za-z_]\w*)` in `(examples\/[\w/.-]+\.ts)`/g)) {
        const exported = new RegExp(`export\\s+(const|let|function|async function|type|interface|class)\\s+${name}\\b`);
        if (!fs.existsSync(path.join(ROOT, file)) || !exported.test(read(file))) {
          missing.push(`${doc}: ${name} in ${file}`);
        }
      }
    }
    expect(missing).to.deep.equal([]);
  });

  it("every linked example script exists", () => {
    const missing: string[] = [];
    for (const doc of docFiles()) {
      for (const [, file] of read(doc).matchAll(/tx-on-chain\/blob\/main\/(examples\/[\w/.-]+\.ts)/g)) {
        if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${doc}: ${file}`);
      }
    }
    expect(missing).to.deep.equal([]);
  });

  // Bug: the docs say ticket accounts only apply "once mainnet runs" the booking program version,
  // but the mainnet IDL and examples in this PR already use book_fixture
  it("no 'not yet on mainnet' caveat for instructions the mainnet IDL already has", () => {
    const mainnetIxs: string[] = idl("mainnet").instructions.map((i: any) => i.name);
    const stale: string[] = [];
    for (const doc of docFiles()) {
      for (const [caveat] of read(doc).matchAll(/once mainnet runs[^.]*\./g)) {
        const named = [...caveat.matchAll(/`(\w+)`/g)].map(m => m[1]);
        if (named.length > 0 && named.every(ix => mainnetIxs.includes(ix))) stale.push(`${doc}: ${caveat}`);
      }
    }
    expect(stale).to.deep.equal([]);
  });
});

for (const network of NETWORKS) {
  describe(`${network} SAMPLE_FIXTURES`, () => {
    // Bug: v2aSnapshot, v2aValidation and v3cValidation outlived the scripts that used them
    it("every entry is used by a script", () => {
      const block = read(`examples/${network}/common/config.ts`).match(/SAMPLE_FIXTURES\s*=\s*\{([\s\S]*?)\n\};/)![1];
      const keys = [...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
      expect(keys).to.not.be.empty;

      const scripts = fs.readdirSync(scriptsDir(network))
        .filter(f => f.endsWith(".ts"))
        .map(f => fs.readFileSync(path.join(scriptsDir(network), f), "utf8"))
        .join("\n");
      expect(keys.filter(k => !scripts.includes(`SAMPLE_FIXTURES.${k}`))).to.deep.equal([]);
    });
  });
}

describe("devnet and mainnet examples stay in sync", () => {
  for (const file of ["common/users.ts", "common/proof.ts"]) {
    it(`${file} is identical`, () => {
      expect(read(`examples/mainnet/${file}`)).to.equal(read(`examples/devnet/${file}`));
    });
  }

  // Run-command comments name the network's mint, RPC and wallet; everything else should match
  const withoutRunComments = (src: string) =>
    src.split("\n").filter(line => !/^\s*\/\/.*(ts-node|ANCHOR_WALLET)/.test(line)).join("\n");

  const shared = fs.readdirSync(scriptsDir("devnet"))
    .filter(f => f.endsWith(".ts") && fs.existsSync(path.join(scriptsDir("mainnet"), f)));

  for (const script of shared) {
    it(`scripts/${script} differs only in its run command`, () => {
      expect(withoutRunComments(read(`examples/mainnet/scripts/${script}`)))
        .to.equal(withoutRunComments(read(`examples/devnet/scripts/${script}`)));
    });
  }
});
