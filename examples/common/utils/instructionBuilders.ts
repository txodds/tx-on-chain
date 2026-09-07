import {
  PublicKey,
  AccountMeta,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { loadIDL } from "./programLoader";
import * as path from "path";
import { convertCamelToSnake, convertSnakeToCamel } from "./caseConversion";

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
  type: any;
}

let cachedIDL: any = null;
let cachedInstructions: { [key: string]: InstructionLayout } = {};

function getInstructionLayout(instructionName: string): InstructionLayout {
  const snakeInstructionName = convertCamelToSnake(instructionName);

  if (cachedInstructions[snakeInstructionName]) {
    return cachedInstructions[snakeInstructionName];
  }

  if (!cachedIDL) {
    const idlPath = path.resolve("./examples/devnet/idl/txoracle.json");
    cachedIDL = loadIDL(idlPath);
  }

  const instrDef = cachedIDL.instructions.find(
    (i: any) => i.name === snakeInstructionName || i.name === instructionName
  );

  if (!instrDef) {
    throw new Error(
      `Instruction not found in IDL: ${instructionName} (snake: ${snakeInstructionName})`
    );
  }

  const layout: InstructionLayout = {
    discriminator: instrDef.discriminator,
    accounts: instrDef.accounts.map((acc: any) => ({
      name: acc.name,
      writable: acc.writable || false,
      signer: acc.signer || false,
    })),
    args: instrDef.args || [],
  };

  cachedInstructions[snakeInstructionName] = layout;
  return layout;
}


export function buildInstruction(
  instructionName: string,
  args: Record<string, any>,
  accounts: Record<string, PublicKey>,
  programId: PublicKey
): TransactionInstruction {
  const instrLayout = getInstructionLayout(instructionName);

  // Map provided account names (camelCase) to IDL names (snake_case)
  const accountsMapped: Record<string, PublicKey> = {};
  for (const [key, value] of Object.entries(accounts)) {
    const snakeKey = convertCamelToSnake(key);
    accountsMapped[snakeKey] = value;
  }

  // Build account metas in the correct order
  const accountMetas: AccountMeta[] = instrLayout.accounts.map((def) => {
    const pubkey = accountsMapped[def.name];
    if (!pubkey) {
      throw new Error(
        `Missing account: ${def.name} (provided: ${Object.keys(accountsMapped).join(", ")})`
      );
    }
    return {
      pubkey,
      isSigner: def.signer || false,
      isWritable: def.writable || false,
    };
  });

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

function encodeInstructionArgs(
  instructionName: string,
  args: Record<string, any>
): Buffer {
  const instrLayout = getInstructionLayout(instructionName);

  if (instrLayout.args.length === 0) {
    return Buffer.alloc(0);
  }

  if (!cachedIDL) {
    const idlPath = path.resolve("./examples/devnet/idl/txoracle.json");
    cachedIDL = loadIDL(idlPath);
  }

  const typesMap = new Map<string, any>();
  cachedIDL.types?.forEach((t: any) => {
    typesMap.set(t.name, t.type);
  });

  const buffers: Buffer[] = [];

  for (const argDef of instrLayout.args) {
    const argName = convertSnakeToCamel(argDef.name);
    const argValue = argName in args ? args[argName] : args[argDef.name];

    if (argValue === undefined) {
      throw new Error(`Missing argument: ${argDef.name}`);
    }

    const encoded = encodeArgument(argValue, argDef.type, typesMap);
    buffers.push(encoded);
  }

  return Buffer.concat(buffers);
}

function encodeArgument(value: any, typeSpec: any, typesMap: Map<string, any>): Buffer {
  if (typeof typeSpec === "string") {
    return encodePrimitive(value, typeSpec);
  }

  if (typeSpec.vec) {
    return encodeVec(value, typeSpec.vec, typesMap);
  }

  if (typeSpec.array) {
    return encodeArray(value, typeSpec.array);
  }

  if (typeSpec.defined) {
    const typeDef = typesMap.get(typeSpec.defined.name);
    if (!typeDef) {
      throw new Error(`Type not found in IDL: ${typeSpec.defined.name}`);
    }
    return encodeStruct(value, typeDef, typesMap);
  }

  throw new Error(`Unsupported type: ${JSON.stringify(typeSpec)}`);
}

function encodePrimitive(value: any, type: string): Buffer {
  switch (type) {
    case "u8":
      return Buffer.from([value & 0xFF]);
    case "u16": {
      const buf = Buffer.alloc(2);
      buf.writeUInt16LE(value, 0);
      return buf;
    }
    case "u32": {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(value, 0);
      return buf;
    }
    case "i16": {
      const buf = Buffer.alloc(2);
      buf.writeInt16LE(value, 0);
      return buf;
    }
    case "i32": {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(value, 0);
      return buf;
    }
    case "u64":
    case "i64": {
      const bn = new BN(value);
      return Buffer.from(bn.toArray("le", 8));
    }
    case "bool":
      return Buffer.from([value ? 1 : 0]);
    case "string": {
      const strBuf = Buffer.from(value, "utf-8");
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(strBuf.length, 0);
      return Buffer.concat([lenBuf, strBuf]);
    }
    case "pubkey":
      if (value instanceof PublicKey) {
        return value.toBuffer();
      }
      return new PublicKey(value).toBuffer();
    default:
      throw new Error(`Unsupported primitive type: ${type}`);
  }
}

function encodeVec(value: any[], elementType: any, typesMap: Map<string, any>): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(value.length, 0);

  const itemBuffers = value.map((item) => encodeArgument(item, elementType, typesMap));

  return Buffer.concat([lenBuf, ...itemBuffers]);
}

function encodeArray(value: any, arraySpec: any): Buffer {
  if (Array.isArray(arraySpec) && arraySpec.length === 2) {
    const [elementType, _length] = arraySpec;
    if (elementType === "u8") {
      if (value instanceof Buffer) {
        return value;
      }
      if (Array.isArray(value)) {
        return Buffer.from(value);
      }
      if (typeof value === "string") {
        return Buffer.from(value, "hex");
      }
    }
  }
  throw new Error(`Unsupported array type: ${JSON.stringify(arraySpec)}`);
}

function encodeStruct(value: any, typeDef: any, typesMap: Map<string, any>): Buffer {
  if (typeDef.kind !== "struct") {
    throw new Error(`Expected struct, got ${typeDef.kind}`);
  }

  const buffers: Buffer[] = [];
  for (const field of typeDef.fields) {
    const fieldNameCamel = convertSnakeToCamel(field.name);
    const fieldValue = value[fieldNameCamel] || value[field.name];

    if (fieldValue === undefined) {
      throw new Error(`Missing struct field: ${field.name}`);
    }

    const encoded = encodeArgument(fieldValue, field.type, typesMap);
    buffers.push(encoded);
  }

  return Buffer.concat(buffers);
}

export function getInstructionDiscriminator(instructionName: string): Buffer {
  const layout = getInstructionLayout(instructionName);
  return Buffer.from(layout.discriminator);
}

export function findInstructionByDiscriminator(discriminator: Buffer): string | null {
  if (!cachedIDL) {
    const idlPath = path.resolve("./examples/devnet/idl/txoracle.json");
    cachedIDL = loadIDL(idlPath);
  }

  for (const instr of cachedIDL.instructions) {
    const instrDiscriminator = Buffer.from(instr.discriminator);
    if (discriminator.equals(instrDiscriminator)) {
      return instr.name;
    }
  }
  return null;
}
