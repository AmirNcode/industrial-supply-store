import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The admin cookie, kept free of `next/headers` so it can be tested without a
 * request — the same split as `repSessionToken.ts`.
 *
 * It used to be `HMAC(ADMIN_PASSWORD, "isupply-admin-v1")`: the same value for
 * every admin, for ever, never checked for age, and a fast hash of the
 * password that let anyone holding a copied cookie guess the password offline
 * (review finding H-9). Now it is `a1.<version>.<expiry>` signed with a key
 * derived from AUTH_SECRET *and* the password:
 *
 *   - the expiry is checked here, on the server, not left to the browser;
 *   - changing ADMIN_PASSWORD changes the key, so every cookie issued under the
 *     old one stops verifying;
 *   - `version` is the admin session version in `app_settings`; "Sign out
 *     everywhere" bumps it, ending every open admin session at once;
 *   - the cookie reveals nothing about the password without AUTH_SECRET.
 */
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function adminKey(secret: string, password: string): Buffer {
  const passwordDigest = createHash("sha256").update(password).digest("hex");
  return createHmac("sha256", secret).update(`admin-session:${passwordDigest}`).digest();
}

function signature(payload: string, secret: string, password: string): string {
  return createHmac("sha256", adminKey(secret, password)).update(payload).digest("base64url");
}

export function signAdminSessionToken(
  version: number,
  expiresAtMs: number,
  secret: string,
  password: string,
): string {
  const payload = `a1.${version}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret, password)}`;
}

/** True only for an unexpired token signed under this secret, password and version. */
export function verifyAdminSessionToken(
  token: string,
  secret: string,
  password: string,
  currentVersion: number,
  nowMs: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "a1") return false;
  const [, versionRaw, expRaw, provided] = parts;
  if (!/^[1-9][0-9]{0,8}$/.test(versionRaw) || !/^[0-9]{1,15}$/.test(expRaw)) return false;
  const expected = signature(`a1.${versionRaw}.${expRaw}`, secret, password);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expRaw) > nowMs && Number(versionRaw) === currentVersion;
}

/**
 * Compares two passwords in time that depends on neither: both are hashed to
 * the same length first. The old comparison returned early on a length
 * mismatch, which told a patient attacker the password's length.
 */
export function passwordsEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
