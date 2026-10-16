/**
 * Publishes the txoracle IDL and types for each network, and checks them against the deployed program.
 *
 *   ts-node scripts/idl.ts trim <devnet|mainnet> [source-idl.json] [--out <dir>]
 *     Reads the IDL built by `make build-<network>` in tx-oracle-onchain (default ../tx-oracle-onchain/<network>/idl),
 *     removes what is not published for that network, and writes examples/<network>/idl/txoracle.json and
 *     examples/<network>/types/txoracle.ts. Mainnet also writes the root idl/ and types/ copies.
 *
 *   ts-node scripts/idl.ts check <devnet|mainnet> [rpc-url]
 *     Reads examples/<network>/idl/txoracle.json and confirms the deployed program has every instruction in it and
 *     embeds every pubkey constant it declares. Exits 1 on any mismatch.
 */
import * as fs from "fs";
import * as path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl";

export type Network = "devnet" | "mainnet";

const ROOT = path.resolve(__dirname, "..");

export const PROGRAM_ID: Record<Network, string> = {
  devnet: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  mainnet: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
};

const DEFAULT_RPC: Record<Network, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

// Directories, relative to the repo root, that receive idl/txoracle.json and types/txoracle.ts
const OUTPUTS: Record<Network, string[]> = {
  devnet: ["examples/devnet"],
  mainnet: ["examples/mainnet", "."],
};

type Removal = { instructions: string[]; accounts: string[]; events: string[]; types: string[] };

// Order intents are not published. The account, events and types listed are used by nothing else.
const INTENTS: Removal = {
  instructions: ["create_intent", "close_intent", "execute_match"],
  accounts: ["OrderIntent"],
  events: ["IntentCreated", "IntentClosed"],
  types: ["IntentCreated", "IntentClosed", "IntentState", "OrderIntent"],
};

// The fake token faucet only exists for devnet
const FAUCET: Removal = {
  instructions: ["request_devnet_faucet"],
  accounts: ["FaucetTracker"],
  events: [],
  types: ["FaucetTracker"],
};

export const REMOVALS: Record<Network, Removal[]> = {
  devnet: [INTENTS],
  mainnet: [INTENTS, FAUCET],
};

// Declared in config/<network>.rs but read by no instruction, so the compiler leaves it out of the program
const UNEMBEDDED_CONSTANTS = ["PROGRAM_ADMIN_PUBKEY"];

const TYPES_HEADER = `/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at \`target/idl/txoracle.json\`.
 */
export type Txoracle = `;

/** Returns a copy of `source` without the entries REMOVALS lists for `network`. Entries already absent are fine. */
export function trimIdl(source: any, network: Network): any {
  if (source.address !== PROGRAM_ID[network]) {
    throw new Error(
      `Source IDL address ${source.address} is not the ${network} program ${PROGRAM_ID[network]}. ` +
      `Was it built with \`make build-${network}\`? Run ./check_program_id.sh ${network} in tx-oracle-onchain.`
    );
  }
  const idl = JSON.parse(JSON.stringify(source));
  for (const removal of REMOVALS[network]) {
    for (const section of ["instructions", "accounts", "events", "types"] as const) {
      if (idl[section]) idl[section] = idl[section].filter((entry: any) => !removal[section].includes(entry.name));
    }
  }
  if (idl.events?.length === 0) delete idl.events;
  assertConsistent(idl);
  return idl;
}

/** Throws if anything refers to a type the IDL does not define, or an account or event has no type. */
export function assertConsistent(idl: any) {
  const defined = new Set((idl.types ?? []).map((t: any) => t.name));
  const missing = new Set<string>();
  JSON.stringify(idl, (key, value) => {
    if (key === "defined" && !defined.has(value.name)) missing.add(value.name);
    return value;
  });
  for (const entry of [...(idl.accounts ?? []), ...(idl.events ?? [])]) {
    if (!defined.has(entry.name)) missing.add(entry.name);
  }
  if (missing.size) throw new Error(`IDL refers to undefined types: ${[...missing].join(", ")}`);
}

/** The types/txoracle.ts that `anchor build` would write for this IDL. */
export function renderTypes(idl: any): string {
  return TYPES_HEADER + JSON.stringify(convertIdlToCamelCase(idl), null, 2) + ";\n";
}

/** Writes the IDL and types for `network` under `root`, returning the paths written. */
export function writeIdl(network: Network, idl: any, root = ROOT): string[] {
  const written: string[] = [];
  for (const dir of OUTPUTS[network]) {
    const idlPath = path.join(root, dir, "idl", "txoracle.json");
    const typesPath = path.join(root, dir, "types", "txoracle.ts");
    fs.mkdirSync(path.dirname(idlPath), { recursive: true });
    fs.mkdirSync(path.dirname(typesPath), { recursive: true });
    // anchor build writes the IDL without a trailing newline
    fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
    fs.writeFileSync(typesPath, renderTypes(idl));
    written.push(idlPath, typesPath);
  }
  return written;
}

/**
 * True if `bytes` (8 of them) is loaded as a 64-bit immediate somewhere in the program. sBPF loads such constants with
 * lddw, a 16-byte instruction: opcode 0x18, registers and offset, low 4 bytes of the value, 4 zero bytes, high 4 bytes.
 * Anchor's instruction dispatch compares discriminators this way, and pubkey constants are loaded 8 bytes at a time.
 */
function loadsImmediate(program: Buffer, bytes: Buffer): boolean {
  const low = bytes.subarray(0, 4);
  const high = bytes.subarray(4, 8);
  for (let i = program.indexOf(low); i !== -1; i = program.indexOf(low, i + 1)) {
    if (i >= 4 && program[i - 4] === 0x18 && program.subarray(i + 8, i + 12).equals(high)) return true;
  }
  return false;
}

/** The executable bytes of an upgradeable program. */
export async function fetchProgram(connection: Connection, programId: PublicKey): Promise<Buffer> {
  const program = await connection.getAccountInfo(programId);
  if (!program) throw new Error(`Program ${programId.toBase58()} does not exist`);
  // UpgradeableLoaderState::Program { programdata_address } after a 4-byte tag
  const programData = await connection.getAccountInfo(new PublicKey(program.data.subarray(4, 36)));
  if (!programData) throw new Error(`Program data for ${programId.toBase58()} does not exist`);
  // UpgradeableLoaderState::ProgramData is a 4-byte tag, an 8-byte slot and a 33-byte optional authority
  return programData.data.subarray(45);
}

export type CheckResult = { missingInstructions: string[]; missingConstants: string[] };

/** Lists the instructions and pubkey constants in `idl` that the deployed program does not have. */
export function checkProgram(idl: any, program: Buffer): CheckResult {
  const missingInstructions = idl.instructions
    .filter((ix: any) => !loadsImmediate(program, Buffer.from(ix.discriminator)))
    .map((ix: any) => ix.name);
  const missingConstants = (idl.constants ?? [])
    .filter((c: any) => c.type === "pubkey" && !UNEMBEDDED_CONSTANTS.includes(c.name))
    .filter((c: any) => {
      const key = new PublicKey(c.value).toBuffer();
      return ![0, 8, 16, 24].every(offset => loadsImmediate(program, key.subarray(offset, offset + 8)));
    })
    .map((c: any) => `${c.name} = ${c.value}`);
  return { missingInstructions, missingConstants };
}

function parseNetwork(value: string | undefined): Network {
  if (value === "devnet" || value === "mainnet") return value;
  throw new Error(`Expected devnet or mainnet, got ${value}`);
}

async function main(args: string[]) {
  const [command, networkArg, ...rest] = args;
  const network = parseNetwork(networkArg);

  if (command === "trim") {
    const outIndex = rest.indexOf("--out");
    const out = outIndex === -1 ? ROOT : path.resolve(rest[outIndex + 1]);
    const positional = rest.filter((_, i) => i !== outIndex && i !== outIndex + 1);
    const source = path.resolve(positional[0] ?? path.join(ROOT, "..", "tx-oracle-onchain", network, "idl", "txoracle.json"));
    const idl = trimIdl(JSON.parse(fs.readFileSync(source, "utf8")), network);
    console.log(`Trimmed ${source} to ${idl.instructions.length} instructions (version ${idl.metadata.version})`);
    for (const file of writeIdl(network, idl, out)) console.log(`  wrote ${path.relative(process.cwd(), file)}`);
  } else if (command === "check") {
    const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "examples", network, "idl", "txoracle.json"), "utf8"));
    const connection = new Connection(rest[0] ?? DEFAULT_RPC[network], "confirmed");
    const { missingInstructions, missingConstants } = checkProgram(idl, await fetchProgram(connection, new PublicKey(idl.address)));
    console.log(`${network} program ${idl.address}: checked ${idl.instructions.length} instructions`);
    for (const name of missingInstructions) console.log(`  instruction not deployed: ${name}`);
    for (const constant of missingConstants) console.log(`  constant not in program: ${constant}`);
    if (missingInstructions.length || missingConstants.length) process.exit(1);
    console.log("  OK");
  } else {
    throw new Error("Usage: ts-node scripts/idl.ts <trim|check> <devnet|mainnet> ...");
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
