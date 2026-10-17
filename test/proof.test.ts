import { expect } from "chai";
import { NETWORKS } from "./helpers";

for (const network of NETWORKS) {
  const proof = require(`../examples/${network}/common/proof`);

  describe(`${network} proof decoders`, () => {
    const hash = Buffer.alloc(32, 0xab);
    const mask = Buffer.alloc(512).fill(0x5a, 0, 256);

    describe("parseHash", () => {
      it("decodes a 64-char hex hash", () => {
        expect(proof.parseHash(hash.toString("hex"))).to.deep.equal(Array.from(hash));
      });

      it("decodes a base64 hash", () => {
        expect(proof.parseHash(hash.toString("base64"))).to.deep.equal(Array.from(hash));
      });

      it("passes byte arrays through", () => {
        expect(proof.parseHash(Array.from(hash))).to.deep.equal(Array.from(hash));
      });
    });

    describe("parseMask", () => {
      it("decodes a base64 rawMask", () => {
        expect(proof.parseMask(mask.toString("base64"))).to.deep.equal(Array.from(mask));
      });

      // Bug: parseHash only treats 64-char strings as hex, so a 1024-char hex mask is base64-decoded
      // to 768 bytes and parseMask throws. The docs say rawMask is "hex or base64".
      it("decodes a hex rawMask (1024 chars)", () => {
        expect(proof.parseMask(mask.toString("hex"))).to.deep.equal(Array.from(mask));
      });

      it("rejects a mask of the wrong length", () => {
        expect(() => proof.parseMask(Buffer.alloc(100).toString("base64"))).to.throw(/512 bytes/);
      });
    });

    describe("parseOddsProofNodes", () => {
      it("passes byte-array hashes through", () => {
        expect(proof.parseOddsProofNodes([{ hash: Array.from(hash), isRightSibling: true }]))
          .to.deep.equal([{ hash: Array.from(hash), isRightSibling: true }]);
      });

      it("treats a missing proof as empty", () => {
        expect(proof.parseOddsProofNodes(undefined)).to.deep.equal([]);
      });

      // Bug: Array.from on a string yields its characters, not the decoded bytes,
      // unlike the scores decoder (parseProofNode) which handles hex/base64 strings.
      for (const encoding of ["hex", "base64"] as const) {
        it(`decodes a ${encoding} string hash to 32 bytes, like the scores decoder`, () => {
          const node = { hash: hash.toString(encoding), isRightSibling: false };
          expect(proof.parseOddsProofNodes([node])).to.deep.equal([proof.parseProofNode(node)]);
        });
      }
    });
  });
}
