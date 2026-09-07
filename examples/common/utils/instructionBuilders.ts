import {
  PublicKey,
  AccountMeta,
  Instruction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import * as borsh from "@coral-xyz/borsh";

// IDL instruction definitions with discriminators
interface InstructionLayout {
  discriminator: number[];
  accounts: AccountMetaDefinition[];
  args: ArgDefinition[];
}

interface AccountMetaDefinition {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
}

interface ArgDefinition {
  name: string;
  type: string;
}

// Discriminator to instruction name mapping
const INSTRUCTION_DISCRIMINATORS: { [key: string]: InstructionLayout } = {
  subscribe: {
    discriminator: [226, 159, 71, 207, 65, 200, 175, 181],
    accounts: [
      { name: "user", writable: true, signer: true },
      { name: "pricingMatrix", writable: false },
      { name: "tokenMint", writable: false },
      { name: "userTokenAccount", writable: true },
      { name: "tokenTreasuryVault", writable: true },
      { name: "tokenTreasuryPda", writable: false },
      { name: "tokenProgram", writable: false },
      { name: "associatedTokenProgram", writable: false },
      { name: "systemProgram", writable: false },
    ],
    args: [
      { name: "serviceLevelId", type: "u32" },
      { name: "weeks", type: "u32" },
    ],
  },
  purchaseValidationCredits: {
    discriminator: [84, 195, 131, 220, 168, 163, 30, 119],
    accounts: [
      { name: "user", writable: true, signer: true },
      { name: "userValidationState", writable: true },
      { name: "tokenMint", writable: false },
      { name: "userTokenAccount", writable: true },
      { name: "tokenTreasuryVault", writable: true },
      { name: "tokenTreasuryPda", writable: false },
      { name: "tokenProgram", writable: false },
      { name: "associatedTokenProgram", writable: false },
      { name: "systemProgram", writable: false },
    ],
    args: [{ name: "creditsToBuy", type: "u32" }],
  },
  validateStatV2: {
    discriminator: [107, 48, 132, 178, 210, 117, 32, 144],
    accounts: [
      { name: "dailyScoresMerkleRoots", writable: false },
    ],
    args: [
      { name: "payload", type: "object" },
      { name: "strategy", type: "object" },
    ],
  },
  validateStatV4: {
    discriminator: [241, 230, 153, 118, 102, 224, 37, 163],
    accounts: [
      { name: "user", writable: false },
      { name: "userValidationState", writable: false },
      { name: "oracleAuthority", writable: false },
      { name: "instructionsSysvar", writable: false },
      { name: "dailyScoresMerkleRoots", writable: false },
    ],
    args: [
      { name: "payload", type: "object" },
      { name: "strategy", type: "object" },
    ],
  },
};

/**
 * Build a Solana instruction from instruction name, arguments, and accounts.
 * Replaces Anchor's program.methods.* pattern.
 */
export function buildInstruction(
  instructionName: string,
  args: Record<string, any>,
  accounts: Record<string, PublicKey>,
  programId: PublicKey
): TransactionInstruction {
  const instrLayout = INSTRUCTION_DISCRIMINATORS[instructionName];
  if (!instrLayout) {
    throw new Error(`Unknown instruction: ${instructionName}`);
  }

  // Build account metas in the correct order
  const accountMetas: AccountMeta[] = instrLayout.accounts.map((def) => {
    const pubkey = accounts[def.name];
    if (!pubkey) {
      throw new Error(`Missing account: ${def.name}`);
    }
    return {
      pubkey,
      isSigner: def.signer || false,
      isWritable: def.writable || false,
    };
  });

  // Encode arguments to buffer
  let data = Buffer.from(instrLayout.discriminator);

  if (instrLayout.args.length > 0) {
    const argData = encodeInstructionArgs(instructionName, args);
    data = Buffer.concat([data, argData]);
  }

  return new TransactionInstruction({
    keys: accountMetas,
    programId,
    data,
  });
}

/**
 * Encode instruction arguments based on instruction type.
 * Handles complex nested types like validation payloads.
 */
function encodeInstructionArgs(
  instructionName: string,
  args: Record<string, any>
): Buffer {
  switch (instructionName) {
    case "subscribe":
      return encodeSubscribeArgs(args);
    case "purchaseValidationCredits":
      return encodePurchaseCreditsArgs(args);
    case "validateStatV2":
      return encodeValidateStatV2Args(args);
    case "validateStatV4":
      return encodeValidateStatV4Args(args);
    default:
      throw new Error(`No encoder for instruction: ${instructionName}`);
  }
}

function encodeSubscribeArgs(args: Record<string, any>): Buffer {
  const schema = new Map([
    [
      "SubscribeArgs",
      {
        kind: "struct",
        fields: [
          ["serviceLevelId", "u32"],
          ["weeks", "u32"],
        ],
      },
    ],
  ]);

  return Buffer.from(
    borsh.serialize(
      schema,
      {
        serviceLevelId: args.serviceLevelId,
        weeks: args.weeks,
      },
      "SubscribeArgs"
    )
  );
}

function encodePurchaseCreditsArgs(args: Record<string, any>): Buffer {
  const schema = new Map([
    [
      "PurchaseCreditsArgs",
      {
        kind: "struct",
        fields: [["creditsToBuy", "u32"]],
      },
    ],
  ]);

  return Buffer.from(
    borsh.serialize(
      schema,
      {
        creditsToBuy: args.creditsToBuy,
      },
      "PurchaseCreditsArgs"
    )
  );
}

function encodeValidateStatV2Args(args: Record<string, any>): Buffer {
  // Complex nested type - encode the entire payload structure
  const payload = args.payload;
  const strategy = args.strategy;

  // For now, delegate to custom serializer since this is very complex
  return encodeValidationPayload(payload, strategy, "v2");
}

function encodeValidateStatV4Args(args: Record<string, any>): Buffer {
  const payload = args.payload;
  const strategy = args.strategy;

  return encodeValidationPayload(payload, strategy, "v4");
}

/**
 * Encode complex validation payloads.
 * This is a simplified version - full implementation would parse entire IDL structure.
 */
function encodeValidationPayload(
  payload: any,
  strategy: any,
  version: "v2" | "v4"
): Buffer {
  // For validation payloads, we need to use the full Borsh layout
  // This is complex and typically generated from the IDL
  // For now, return empty buffer - this needs custom implementation per payload structure
  console.warn(
    `Validation payload encoding for ${version} requires full IDL schema implementation`
  );
  return Buffer.alloc(0);
}

/**
 * Helper to get instruction discriminator by name.
 * Useful for instruction decoding.
 */
export function getInstructionDiscriminator(
  instructionName: string
): Buffer {
  const layout = INSTRUCTION_DISCRIMINATORS[instructionName];
  if (!layout) {
    throw new Error(`Unknown instruction: ${instructionName}`);
  }
  return Buffer.from(layout.discriminator);
}

/**
 * Find instruction name by discriminator.
 * Useful for decoding instructions from transactions.
 */
export function findInstructionByDiscriminator(
  discriminator: Buffer
): string | null {
  for (const [name, layout] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    const layoutDiscriminator = Buffer.from(layout.discriminator);
    if (discriminator.equals(layoutDiscriminator)) {
      return name;
    }
  }
  return null;
}
