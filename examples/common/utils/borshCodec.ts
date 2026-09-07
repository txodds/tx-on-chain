import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import { convertSnakeToCamel } from "./caseConversion";

/**
 * Custom Borsh codec for complex types found in the Txoracle program.
 * This provides encoding/decoding for validation payloads and other complex structures.
 */

let cachedIdl: any = null;
let cachedDiscriminatorMap: { [key: string]: string } | null = null;

/**
 * Load IDL from file system. Caches the result to avoid repeated reads.
 * Looks for txoracle.json in multiple locations.
 */
function loadIdl(): any {
  if (cachedIdl) return cachedIdl;

  const possiblePaths = [
    path.resolve(__dirname, "../../../idl/txoracle.json"),
    path.resolve(__dirname, "../../idl/txoracle.json"),
    path.resolve(__dirname, "../../../examples/devnet/idl/txoracle.json"),
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        cachedIdl = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        console.info("IDL found in:", filePath);        
        return cachedIdl;
      }
    } catch {
      // Continue to next path
    }
  }

  throw new Error("Could not locate txoracle.json IDL file");
}

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
 * TODO: Implement proper Borsh encoding using @coral-xyz/borsh layout builders
 */
export function encodeValidationInput(
  payload: any,
  schemas?: Map<string, any>
): Buffer {
  // Placeholder implementation - returns empty buffer
  // Full implementation requires manual layout-based encoding
  console.warn("encodeValidationInput: Using placeholder implementation");
  return Buffer.alloc(0);
}

/**
 * Build discriminator map from IDL instruction definitions.
 * Converts byte array discriminators to hex strings for lookup.
 */
function buildDiscriminatorMap(idl: any): { [key: string]: string } {
  const map: { [key: string]: string } = {};

  if (idl?.instructions && Array.isArray(idl.instructions)) {
    for (const instruction of idl.instructions) {
      if (instruction.name && instruction.discriminator) {
        // Convert byte array to hex string
        const hexDiscriminator = Buffer.from(instruction.discriminator).toString("hex");
        map[hexDiscriminator] = instruction.name;
      }
    }
  }

  return map;
}

/**
 * Decode instruction data to extract decoded instruction details.
 * Replaces Anchor's program.coder.instruction.decode()
 * Automatically loads and caches IDL to dynamically build discriminator map.
 * No need to update code when new instructions are added to the program.
 */
export function decodeInstruction(
  data: Buffer,
  programId?: string,
  idl?: any
): {
  name: string;
  data: any;
} | null {
  if (data.length < 8) {
    return null;
  }

  const discriminator = data.subarray(0, 8);
  const args = data.subarray(8);

  // Build discriminator map once and cache it
  if (!cachedDiscriminatorMap) {
    const resolvedIdl = idl || loadIdl();
    cachedDiscriminatorMap = buildDiscriminatorMap(resolvedIdl);
  }

  const hexDiscriminator = discriminator.toString("hex");
  const instrName = cachedDiscriminatorMap[hexDiscriminator];

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
  const camelCaseName = convertSnakeToCamel(instructionName);
  switch (camelCaseName) {
    case "subscribe":
      return parseSubscribeArgs(data);
    case "purchaseValidationCredits":
      return parsePurchaseCreditsArgs(data);
    case "purchaseSubscriptionTokenUsdt":
      return parsePurchaseSubscriptionTokenUsdtArgs(data);
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

function parsePurchaseSubscriptionTokenUsdtArgs(data: Buffer): any {
  if (data.length < 8) return null;

  const txlineAmount = new BN(data.subarray(0, 8), "le");

  return {
    txlineAmount,
  };
}

/**
 * Convert account data buffer to decoded account structure.
 * This is a simplified version - full implementation would use complete IDL.
 * TODO: Implement proper Borsh decoding using @coral-xyz/borsh layout builders
 */
export function decodeAccountData(
  data: Buffer,
  accountType: string,
  schemas?: Map<string, any>
): any {
  // Placeholder implementation - returns null
  // Full implementation requires manual layout-based decoding
  console.warn(`decodeAccountData: Using placeholder implementation for ${accountType}`);
  return null;
}
