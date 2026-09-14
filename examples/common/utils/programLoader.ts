import { PublicKey, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Simple program wrapper for Solana v2.
 * Provides minimal interface needed by setupUser and other utilities.
 * Replaces Anchor's Program class for the examples.
 */
export interface ProgramInfo {
  programId: PublicKey;
  idlPath?: string;
  connection?: Connection;
  account?: {
    [key: string]: {
      fetch: (address: PublicKey) => Promise<any>;
    };
  };
}

/**
 * Load program information from IDL or environment.
 * For TxOracle program:
 * - Devnet: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
 * - Mainnet: (specific mainnet address)
 */
export function loadProgram(
  network: "devnet" | "mainnet",
  connection?: Connection
): ProgramInfo {
  const programIds = {
    devnet: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    mainnet: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J", // Update with actual mainnet ID
  };

  const programId = new PublicKey(programIds[network]);

  // Try to load IDL if available
  let idlPath: string | undefined;
  const idlLocations = [
    `./examples/${network}/idl/txoracle.json`,
    `./examples/devnet/idl/txoracle.json`, // Fallback
  ];

  for (const location of idlLocations) {
    try {
      if (fs.existsSync(location)) {
        idlPath = path.resolve(location);
        break;
      }
    } catch (err) {
      // Continue searching
    }
  }

  const programInfo: ProgramInfo = {
    programId,
    idlPath,
    connection,
  };

  // Add account deserialization interface if connection is available
  if (connection) {
    programInfo.account = createAccountFetcher(connection);
  }

  return programInfo;
}

/**
 * Create an account fetcher compatible with Anchor's program.account pattern.
 * Fetches raw account data from RPC and returns a generic object.
 */
function createAccountFetcher(
  connection: Connection
): { [key: string]: { fetch: (address: PublicKey) => Promise<any> } } {
  return new Proxy(
    {},
    {
      get: (_target, accountName) => ({
        fetch: async (address: PublicKey) => {
          const accountInfo = await connection.getAccountInfo(address);
          if (!accountInfo) {
            throw new Error(`Account not found: ${address.toBase58()}`);
          }

          // Skip the 8-byte Anchor discriminator and deserialize the remaining data as Borsh
          const data = Buffer.from(accountInfo.data).subarray(8);
          try {
            // Use a generic deserializer that works with the Borsh format
            return deserializeAccountData(data, String(accountName));
          } catch (err) {
            throw new Error(
              `Failed to deserialize ${String(accountName)} at ${address.toBase58()}: ${err}`
            );
          }
        },
      }),
    }
  );
}

/**
 * Deserialize account data using Borsh.
 * Returns a generic object representing the account structure.
 */
function deserializeAccountData(data: Buffer, accountType: string): any {
  // For now, return a proxy that allows property access
  // In production, you'd parse the Borsh layout based on the IDL
  const obj: any = {};

  // Read data as generic Borsh structure
  // This is a placeholder that handles common patterns
  try {
    // Try to interpret as a generic struct with common field types
    // This works for simple structs with u64, u32, Pubkey, etc.
    let offset = 0;

    // PricingMatrix specific parsing
    if (accountType === "pricingMatrix") {
      obj.admin = new PublicKey(Buffer.from(data).subarray(offset, offset + 32));
      offset += 32;

      const rowsLen = data.readUInt32LE(offset);
      offset += 4;

      obj.rows = [];
      for (let i = 0; i < rowsLen && offset < data.length; i++) {
        const row: any = {};
        row.rowId = data.readUInt16LE(offset);
        offset += 2;
        row.pricePerWeekToken = data.readBigUInt64LE(offset);
        offset += 8;
        row.samplingIntervalSec = data.readUInt32LE(offset);
        offset += 4;
        row.leagueBundleId = data.readInt16LE(offset);
        offset += 2;
        row.marketBundleId = data.readInt16LE(offset);
        offset += 2;
        obj.rows.push(row);
      }
    }

    return obj;
  } catch (err) {
    console.warn(`Warning: Could not deserialize ${accountType}:`, err);
    return {};
  }
}

/**
 * Load IDL from file.
 * Useful for instruction builders and account deserializers.
 */
export function loadIDL(idlPath: string): any {
  try {
    const content = fs.readFileSync(idlPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to load IDL from ${idlPath}: ${err}`);
  }
}

/**
 * Get program ID by network.
 * Can also be determined from ANCHOR_PROVIDER_URL environment variable.
 */
export function getProgramId(
  network?: "devnet" | "mainnet"
): PublicKey {
  // Check environment variable first
  const programIdEnv = process.env.PROGRAM_ID;
  if (programIdEnv) {
    return new PublicKey(programIdEnv);
  }

  // Determine network from provider URL if not specified
  if (!network) {
    const providerUrl = process.env.ANCHOR_PROVIDER_URL || "";
    if (providerUrl.includes("mainnet")) {
      network = "mainnet";
    } else {
      network = "devnet";
    }
  }

  // Return network-specific program ID
  const programInfo = loadProgram(network);
  return programInfo.programId;
}
