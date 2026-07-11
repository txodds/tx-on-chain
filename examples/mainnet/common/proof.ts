export type Bytes32Input = number[] | Uint8Array | Buffer | string;

function assertBytes(bytes: readonly number[], label: string): number[] {
  if (bytes.length !== 32) {
    throw new Error(`${label} must contain exactly 32 bytes; received ${bytes.length}`);
  }

  return Array.from({ length: bytes.length }, (_, index) => {
    const byte = bytes[index];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label}[${index}] is not an unsigned byte`);
    }
    return byte;
  });
}

/**
 * Decode a Merkle root/hash without ever treating a string as an iterable of
 * characters. String inputs must be either canonical padded base64 or 0x hex.
 */
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

  // A 32-byte canonical base64 value is 44 characters and ends in one '='.
  // Round-tripping rejects non-canonical padding and permissive decoder input.
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
