import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The "this browser has signed in to this account before" mark that lets its
 * owner through a sign-in lockout (`lib/signInGuard.ts`). Kept free of
 * `next/headers` so it can be tested without a request, like
 * `adminSessionToken.ts`.
 *
 * It used to be an HMAC of the login alone: the same value in every browser,
 * valid on the server for ever, and untouched by a password change — so
 * anyone who had once signed in, with a password since changed, kept a way
 * past the lockout (fix review F-4). Now it is `d1.<expiry>.<signature>`,
 * signed over the account's session version as well:
 *
 *   - the expiry is checked here, not left to the cookie's own lifetime;
 *   - every password change or reset bumps the session version, which retires
 *     every mark issued before it — for the admin, "Sign out everywhere" does
 *     the same.
 */
export const DEVICE_MARK_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function signature(
  secret: string,
  kind: string,
  loginKey: string,
  version: number,
  expiresAtMs: number,
): string {
  return createHmac("sha256", secret)
    .update(`known-device\0${kind}\0${loginKey}\0${version}\0${expiresAtMs}`)
    .digest("base64url");
}

export function signDeviceMark(
  secret: string,
  kind: string,
  loginKey: string,
  version: number,
  expiresAtMs: number,
): string {
  return `d1.${expiresAtMs}.${signature(secret, kind, loginKey, version, expiresAtMs)}`;
}

/**
 * True only for an unexpired mark issued to this account at its current
 * session version. `version` is null for a login with no account, which no
 * mark can match.
 */
export function verifyDeviceMark(
  mark: string,
  secret: string,
  kind: string,
  loginKey: string,
  version: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (version === null) return false;
  const parts = mark.split(".");
  if (parts.length !== 3 || parts[0] !== "d1" || !/^[0-9]{1,15}$/.test(parts[1])) return false;
  const expiresAtMs = Number(parts[1]);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(signature(secret, kind, loginKey, version, expiresAtMs));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return expiresAtMs > nowMs;
}
