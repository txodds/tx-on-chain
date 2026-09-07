import BN from "bn.js";
import { loadIDL } from "./programLoader";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";

let cachedIDL: any = null;
let cachedTypes: Map<string, any> | null = null;

function getIDL(): any {
  if (!cachedIDL) {
    const idlPath = path.resolve("./examples/devnet/idl/txoracle.json");
    cachedIDL = loadIDL(idlPath);
  }
  return cachedIDL;
}

function getTypesMap(): Map<string, any> {
  if (!cachedTypes) {
    const idl = getIDL();
    cachedTypes = new Map();
    idl.types?.forEach((t: any) => {
      cachedTypes!.set(t.name, t.type);
    });
  }
  return cachedTypes;
}

function convertSnakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
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
    const [elementType] = arraySpec;
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

function encodeOption(value: any, innerType: any, typesMap: Map<string, any>): Buffer {
  if (value === null || value === undefined) {
    return Buffer.from([0]);
  }
  const innerEncoded = encodeArgument(value, innerType, typesMap);
  return Buffer.concat([Buffer.from([1]), innerEncoded]);
}

function encodeStruct(value: any, typeDef: any, typesMap: Map<string, any>): Buffer {
  if (typeDef.kind !== "struct") {
    throw new Error(`Expected struct, got ${typeDef.kind}`);
  }

  const buffers: Buffer[] = [];
  for (const field of typeDef.fields) {
    const fieldNameCamel = convertSnakeToCamel(field.name);
    const fieldValue = value[fieldNameCamel] || value[field.name];

    if (fieldValue === undefined && field.type.option === undefined) {
      throw new Error(`Missing struct field: ${field.name}`);
    }

    const encoded = encodeArgument(fieldValue, field.type, typesMap);
    buffers.push(encoded);
  }

  return Buffer.concat(buffers);
}

function encodeArgument(value: any, typeSpec: any, typesMap: Map<string, any>): Buffer {
  if (typeof typeSpec === "string") {
    return encodePrimitive(value, typeSpec);
  }

  if (typeSpec.option) {
    return encodeOption(value, typeSpec.option, typesMap);
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

export function encodeOddsValidationInputV4(payload: any): Buffer {
  const typesMap = getTypesMap();
  const typeDef = typesMap.get("OddsValidationInputV4");

  if (!typeDef) {
    throw new Error("OddsValidationInputV4 type not found in IDL");
  }

  return encodeStruct(payload, typeDef, typesMap);
}
