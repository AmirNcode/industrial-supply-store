import "server-only";
import { readFileSync } from "node:fs";

/**
 * One application signing key for every server-issued token.
 *
 * Keeping the production guard here prevents a new signed feature from
 * quietly inventing a second fallback or accepting a weaker secret than the
 * account session cookie.
 */
function resolveAuthSecret(): string {
  let fileSecret = "";
  const secretFile = process.env.AUTH_SECRET_FILE;
  if (secretFile) {
    try {
      fileSecret = readFileSync(secretFile, "utf8").trim();
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Could not read AUTH_SECRET_FILE at ${secretFile}`, { cause: error });
      }
    }
  }

  const secret = process.env.AUTH_SECRET || fileSecret;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production (16+ characters)");
  }
  console.warn("⚠  AUTH_SECRET unset — using a development-only key");
  return "development-only-insecure-key";
}

export const AUTH_SECRET = resolveAuthSecret();
