import { BN } from "@coral-xyz/anchor";

function assertBytes(bytes: readonly number[], label: string): number[] {
  if (bytes.length !== 32) {
    throw new Error(`${label} must contain exactly 32 bytes; received ${bytes.length}`);
  }

  return Array.from(bytes, (byte, index) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label}[${index}] is not an unsigned byte`);
    }
    return byte;
  });
}

export function decodeBytes32(value: unknown, label = "bytes32"): number[] {
  if (Array.isArray(value)) {
    return assertBytes(value, label);
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return assertBytes(Array.from(value), label);
  }

  if (typeof value !== "string") {
    throw new Error(`${label} has an unsupported encoding`);
  }

  if (value.startsWith("0x")) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error(`${label} must be 0x followed by exactly 64 hex digits`);
    }
    return assertBytes(Array.from(Buffer.from(value.slice(2), "hex")), label);
  }

  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`${label} must be canonical padded base64 or 0x hex`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return assertBytes(Array.from(decoded), label);
}

export type AnchorProofNode = {
  hash: number[];
  isRightSibling: boolean;
};

export function decodeProofNodes(value: unknown, label = "proof"): AnchorProofNode[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label}[${index}] must be an object`);
    }
    const node = entry as Record<string, unknown>;
    if (typeof node.isRightSibling !== "boolean") {
      throw new Error(`${label}[${index}].isRightSibling must be boolean`);
    }
    return {
      hash: decodeBytes32(node.hash, `${label}[${index}].hash`),
      isRightSibling: node.isRightSibling,
    };
  });
}

const FIXTURE_ID_DIVISOR = new BN(2).pow(new BN(48));
const MAX_UNSIGNED_64_BIT = new BN(2).pow(new BN(64)).subn(1);

function decodeUnsignedBn(value: unknown, label: string): BN {
  if (BN.isBN(value)) {
    const bnValue = value as BN;
    if (bnValue.isNeg()) {
      throw new Error(`${label} must be an unsigned decimal integer`);
    }
    return bnValue.clone();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer or a decimal string`);
    }
    if (value < 0) {
      throw new Error(`${label} must be an unsigned decimal integer`);
    }
    return new BN(value);
  }

  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an unsigned decimal integer`);
  }
  return new BN(value, 10);
}

export function unpackFixtureId(value: unknown): {
  packedId: BN;
  fixtureId: BN;
  gameState: number;
} {
  const packedId = decodeUnsignedBn(value, "packed FixtureId");
  if (packedId.gt(MAX_UNSIGNED_64_BIT)) {
    throw new Error("packed FixtureId must be an unsigned 64-bit integer");
  }

  return {
    packedId,
    fixtureId: packedId.mod(FIXTURE_ID_DIVISOR),
    gameState: packedId.div(FIXTURE_ID_DIVISOR).toNumber(),
  };
}
