import { PublicKey } from "@solana/web3.js";
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
}

/**
 * Load program information from IDL or environment.
 * For TxOracle program:
 * - Devnet: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
 * - Mainnet: (specific mainnet address)
 */
export function loadProgram(network: "devnet" | "mainnet"): ProgramInfo {
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

  return {
    programId,
    idlPath,
  };
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
