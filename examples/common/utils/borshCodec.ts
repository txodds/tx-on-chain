import * as borsh from "@coral-xyz/borsh";
import BN from "bn.js";

/**
 * Custom Borsh codec for complex types found in the Txoracle program.
 * This provides encoding/decoding for validation payloads and other complex structures.
 */

// Schema for validation-related types
export const VALIDATION_SCHEMAS = {
  UpdateStats: {
    kind: "struct" as const,
    fields: [
      ["updateCount", "u32"],
      ["minTimestamp", "i64"],
      ["maxTimestamp", "i64"],
    ],
  },

  FixtureSummary: {
    kind: "struct" as const,
    fields: [
      ["fixtureId", "i64"],
      ["updateStats", "UpdateStats"],
      ["eventsSubTreeRoot", ["u8", 32]],
    ],
  },

  ProofNode: {
    kind: "struct" as const,
    fields: [
      ["hash", ["u8", 32]],
      ["isRightSibling", "u8"],
    ],
  },

  StatLeaf: {
    kind: "struct" as const,
    fields: [
      ["key", "u32"],
      ["value", "i64"],
      ["period", "u32"],
    ],
  },

  StatValidationInput: {
    kind: "struct" as const,
    fields: [
      ["ts", "i64"],
      ["fixtureSummary", "FixtureSummary"],
      ["fixtureProof", ["ProofNode"]],
      ["mainTreeProof", ["ProofNode"]],
      ["eventStatRoot", ["u8", 32]],
      ["stats", "unknown"], // Complex nested type - needs special handling
    ],
  },

  Comparison: {
    kind: "enum" as const,
    variants: [
      { name: "equalTo", fields: [] },
      { name: "lessThan", fields: [] },
      { name: "greaterThan", fields: [] },
      { name: "lessOrEqual", fields: [] },
      { name: "greaterOrEqual", fields: [] },
      { name: "notEqual", fields: [] },
    ],
  },

  StatPredicate: {
    kind: "struct" as const,
    fields: [
      ["threshold", "i64"],
      ["comparison", "Comparison"],
    ],
  },

  BinaryOperation: {
    kind: "enum" as const,
    variants: [
      { name: "add", fields: [] },
      { name: "subtract", fields: [] },
      { name: "multiply", fields: [] },
      { name: "divide", fields: [] },
    ],
  },

  BinaryExpression: {
    kind: "struct" as const,
    fields: [
      ["indexA", "u32"],
      ["indexB", "u32"],
      ["op", "BinaryOperation"],
      ["predicate", "StatPredicate"],
    ],
  },

  DiscretePredicateVariant: {
    kind: "enum" as const,
    variants: [
      {
        name: "single",
        fields: [
          ["fields", ["u32", "StatPredicate"]],
        ],
      },
      {
        name: "binary",
        fields: [
          ["fields", "BinaryExpression"],
        ],
      },
    ],
  },

  NDimensionalStrategy: {
    kind: "struct" as const,
    fields: [
      ["geometricTargets", "unknown"], // Vec of geometric targets
      ["distancePredicate", "unknown"], // Option<StatPredicate>
      ["discretePredicates", "unknown"], // Vec<DiscretePredicateVariant>
    ],
  },
};

/**
 * Encode a complex validation input structure.
 * Note: This is a simplified version - full schema needs complete IDL parsing.
 */
export function encodeValidationInput(
  payload: any,
  schemas?: Map<string, any>
): Buffer {
  const fullSchemas = schemas || new Map();

  // Add all validation schemas
  for (const [name, schema] of Object.entries(VALIDATION_SCHEMAS)) {
    if (!fullSchemas.has(name)) {
      fullSchemas.set(name, schema);
    }
  }

  try {
    return Buffer.from(
      borsh.serialize(fullSchemas, payload, "StatValidationInput")
    );
  } catch (err) {
    console.error("Failed to encode validation input:", err);
    throw err;
  }
}

/**
 * Decode instruction data to extract decoded instruction details.
 * Replaces Anchor's program.coder.instruction.decode()
 */
export function decodeInstruction(
  data: Buffer,
  programId: string
): {
  name: string;
  data: any;
} | null {
  if (data.length < 8) {
    return null;
  }

  const discriminator = data.slice(0, 8);
  const args = data.slice(8);

  // Map discriminators to instruction handlers
  // This would typically come from IDL parsing
  const discriminatorMap: { [key: string]: string } = {
    "e29f47cf41c8afb5": "subscribe",
    "54c383dca8a31e77": "purchaseValidationCredits",
    "6b3084b2d27520": "validateStatV2",
    "f1e69976e6e225a3": "validateStatV4",
  };

  const hexDiscriminator = discriminator.toString("hex");
  const instrName = discriminatorMap[hexDiscriminator];

  if (!instrName) {
    return null;
  }

  return {
    name: instrName,
    data: args,
  };
}

/**
 * Helper to manually parse instruction arguments.
 * Used when we need to validate instruction data before signing.
 */
export function parseInstructionArgs(
  instructionName: string,
  data: Buffer
): any {
  switch (instructionName) {
    case "subscribe":
      return parseSubscribeArgs(data);
    case "purchaseValidationCredits":
      return parsePurchaseCreditsArgs(data);
    default:
      return null;
  }
}

function parseSubscribeArgs(data: Buffer): any {
  if (data.length < 8) return null;

  const serviceLevelId = data.readUInt32LE(0);
  const weeks = data.readUInt32LE(4);

  return {
    serviceLevelId,
    weeks,
  };
}

function parsePurchaseCreditsArgs(data: Buffer): any {
  if (data.length < 4) return null;

  const creditsToBuy = data.readUInt32LE(0);

  return {
    creditsToBuy,
  };
}

/**
 * Convert account data buffer to decoded account structure.
 * This is a simplified version - full implementation would use complete IDL.
 */
export function decodeAccountData(
  data: Buffer,
  accountType: string,
  schemas?: Map<string, any>
): any {
  const fullSchemas = schemas || new Map();

  // Add validation schemas
  for (const [name, schema] of Object.entries(VALIDATION_SCHEMAS)) {
    if (!fullSchemas.has(name)) {
      fullSchemas.set(name, schema);
    }
  }

  try {
    return borsh.deserialize(fullSchemas, Buffer.from(data), accountType);
  } catch (err) {
    console.error(`Failed to decode ${accountType}:`, err);
    return null;
  }
}
