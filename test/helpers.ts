import * as fs from "fs";
import * as path from "path";

export const ROOT = path.resolve(__dirname, "..");
export const NETWORKS = ["devnet", "mainnet"] as const;
export type Network = typeof NETWORKS[number];

export function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

export function idl(network: Network): any {
  return JSON.parse(read(`examples/${network}/idl/txoracle.json`));
}

export function backendAdminKey(network: Network): string {
  return idl(network).constants.find((c: any) => c.name === "BACKEND_ADMIN_PUBKEY").value;
}
