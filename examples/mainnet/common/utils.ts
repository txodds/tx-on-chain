import {
  getStructEncoder,
  getI64Encoder,
  getU64Encoder,
  getI32Encoder,
  getU32Encoder,
  getU16Encoder,
  getU8Encoder,
  getBooleanEncoder,
  getBytesEncoder,
  getUtf8Encoder,
  addEncoderSizePrefix,
  fixEncoderSize,
  getArrayEncoder,
  getOptionEncoder,
  getDiscriminatedUnionEncoder,
  some,
  none,
  Encoder,
  getAddressEncoder
} from "@solana/kit";

// Compose standard Borsh string encoder
const borshStringEncoder = addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder());

// Resolve specific IDL type to kit encoder
function resolveTypeEncoder(idl: any, type: any): Encoder<any> {
  if (typeof type === "string") {
    switch (type) {
      case "i64": return getI64Encoder();
      case "u64": return getU64Encoder();
      case "i32": return getI32Encoder();
      case "u32": return getU32Encoder();
      case "u16": return getU16Encoder();
      case "u8": return getU8Encoder();
      case "bool": return getBooleanEncoder();
      case "string": return borshStringEncoder;
      case 'pubkey': return getAddressEncoder();
      default: throw new Error(`Unsupported IDL type: ${type}`);
    }
  } else if (type.defined) {
    const nestedTypeName = typeof type.defined === "string" 
      ? type.defined 
      : type.defined.name;
    return createIdlEncoder(idl, nestedTypeName);
  } else if (type.array) {
    const [arrayType, size] = type.array;
    if (arrayType === "u8") {
      return fixEncoderSize(getBytesEncoder(), size);
    } else {
      throw new Error(`Unsupported array type: ${arrayType}`);
    }
  } else if (type.vec) {
    const innerEncoder = resolveTypeEncoder(idl, type.vec);
    return getArrayEncoder(innerEncoder, { size: getU32Encoder() });
  } else if (type.option) {
    const innerEncoder = resolveTypeEncoder(idl, type.option);
    return getOptionEncoder(innerEncoder); // Defaults to u8 prefix (Borsh standard)
  } else {
    throw new Error(`Complex type not handled: ${JSON.stringify(type)}`);
  }
}

// Build kit encoders dynamically from Anchor IDL definitions using case-insensitive matching
export function createIdlEncoder(idl: any, typeName: string): Encoder<any> {
  const typeDef = idl.types.find((t: any) => t.name.toLowerCase() === typeName.toLowerCase());
  
  if (!typeDef) {
    const availableTypes = idl.types.map((t: any) => t.name).join(", ");
    throw new Error(`Type ${typeName} not found in IDL. Available types: ${availableTypes}`);
  }

  // Handle Anchor Enums
  if (typeDef.type.kind === "enum") {
    const variants = typeDef.type.variants.map((v: any) => {
      // Parameterless variant
      if (!v.fields) return [v.name, getStructEncoder([])] as const;
      
      // Data variant with fields
      const fieldEncoders = v.fields.map((f: any) => {
        const encoder = resolveTypeEncoder(idl, f.type || f);
        return [f.name || 'value', encoder] as const;
      });
      return [v.name, getStructEncoder(fieldEncoders)] as const;
    });
    return getDiscriminatedUnionEncoder(variants as any) as Encoder<any>;
  }

  // Default to Struct
  const fields = (typeDef.type.fields || []).map((field: any) => {
    const encoder = resolveTypeEncoder(idl, field.type);
    return [field.name, encoder] as const;
  });

  return getStructEncoder(fields);
}

// Format single value to match IDL type recursively
function formatValueToIdl(idl: any, type: any, rawValue: any): any {
  if (typeof type === "string") {
    if (type === "i64" || type === "u64" || type === "i128" || type === "u128") {
      return BigInt(rawValue);
    }
    return rawValue;
  } else if (type.defined) {
    const nestedTypeName = typeof type.defined === "string" 
      ? type.defined 
      : type.defined.name;
    return formatPayloadToIdl(idl, nestedTypeName, rawValue);
  } else if (type.array) {
    const arrayType = type.array[0];
    if (arrayType === "u8") {
      return new Uint8Array(rawValue);
    }
    return rawValue;
  } else if (type.vec) {
    if (Array.isArray(rawValue)) {
      return rawValue.map((item) => formatValueToIdl(idl, type.vec, item));
    }
    return rawValue;
  } else if (type.option) {
    if (rawValue === null || rawValue === undefined) {
      return none();
    }
    return some(formatValueToIdl(idl, type.option, rawValue));
  }
  return rawValue;
}

// Format arbitrary API payload to strictly match IDL types and casing
export function formatPayloadToIdl(idl: any, typeName: string, payload: any): any {
  const typeDef = idl.types.find((t: any) => t.name.toLowerCase() === typeName.toLowerCase());
  
  if (!typeDef) {
    throw new Error(`Type ${typeName} not found in IDL`);
  }

  // Translate Anchor Enum syntax to @solana/kit discriminator syntax
  if (typeDef.type.kind === "enum") {
    const variantKey = Object.keys(payload)[0];
    const normalizedVariantKey = variantKey.replace(/_/g, "").toLowerCase();
    
    const variantDef = typeDef.type.variants.find(
      (v: any) => v.name.replace(/_/g, "").toLowerCase() === normalizedVariantKey
    );

    if (!variantDef) throw new Error(`Variant ${variantKey} not found in enum ${typeName}`);

    // Map to @solana/kit format using the __kind discriminator
    const kitEnumPayload: any = { __kind: variantDef.name };
    
    if (variantDef.fields && payload[variantKey]) {
      variantDef.fields.forEach((field: any) => {
        const fieldName = field.name || 'value';
        const rawFieldValue = payload[variantKey][fieldName];
        kitEnumPayload[fieldName] = formatValueToIdl(idl, field.type, rawFieldValue);
      });
    }
    
    return kitEnumPayload;
  }

  // Handle Struct
  const formattedData: any = {};
  const fields = typeDef.type.fields || [];

  fields.forEach((field: any) => {
    const normalizedFieldName = field.name.replace(/_/g, "").toLowerCase();
    const payloadKey = Object.keys(payload).find(
      k => k.replace(/_/g, "").toLowerCase() === normalizedFieldName
    );

    const rawValue = payloadKey ? payload[payloadKey] : undefined;

    // Allow undefined only if the type is explicitly an Option
    const isOption = !!field.type.option;
    if (rawValue === undefined && !isOption) {
      throw new Error(`Missing field ${field.name} in data payload for struct ${typeName}`);
    }

    formattedData[field.name] = formatValueToIdl(idl, field.type, rawValue);
  });

  return formattedData;
}
