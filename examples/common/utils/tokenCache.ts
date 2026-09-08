import * as fs from "fs";
import * as path from "path";

const TOKEN_FILE_SUFFIX = ".token";

export function getTokenFromCache(keypairPath: string): string | null {
  try {
    const tokenPath = getTokenFilePath(keypairPath);
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, "utf8").trim();
      if (token) {
        console.log(`[Token Cache] Loaded cached API token from ${path.basename(tokenPath)}`);
        return token;
      }
    }
  } catch (err) {
    console.warn(`[Token Cache] Could not read token cache: ${err}`);
  }
  return null;
}

export function saveTokenToCache(keypairPath: string, token: string): void {
  try {
    const tokenPath = getTokenFilePath(keypairPath);
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
    console.log(`[Token Cache] Persisted API token to ${path.basename(tokenPath)}`);
  } catch (err) {
    console.warn(`[Token Cache] Could not save token cache: ${err}`);
  }
}

export function invalidateTokenCache(keypairPath: string): void {
  try {
    const tokenPath = getTokenFilePath(keypairPath);
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log(`[Token Cache] Invalidated cached token at ${path.basename(tokenPath)}`);
    }
  } catch (err) {
    console.warn(`[Token Cache] Could not invalidate token cache: ${err}`);
  }
}

function getTokenFilePath(keypairPath: string): string {
  const dir = path.dirname(keypairPath);
  const filename = path.basename(keypairPath, ".json");
  return path.join(dir, `.${filename}${TOKEN_FILE_SUFFIX}`);
}
