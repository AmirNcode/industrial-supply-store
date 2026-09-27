import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The rep cookie, kept free of `next/headers` so it can be tested without a
 * request — the same split as `sessionToken.ts`.
 *
 * Unlike the customer cookie it carries a session version. The rep row holds
 * the current version, and deactivation, a password reset or a password change
 * increments it, so a cookie minted before any of those stops working at once.
 */
export const REP_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key derived for this purpose alone. A customer cookie is signed with
 * AUTH_SECRET itself, so it can never verify here, and nothing signed here can
 * verify as a customer session.
 */
function repKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("rep-session").digest();
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", repKey(secret)).update(payload).digest("base64url");
}

export function signRepSessionToken(
  repId: string,
  version: number,
  expiresAtMs: number,
  secret: string,
): string {
  const payload = `v1.${repId}.${version}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret)}`;
}

export type RepSessionClaim = { repId: string; version: number };

export function verifyRepSessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): RepSessionClaim | null {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, repId, versionRaw, expRaw, provided] = parts;
  if (!UUID.test(repId) || !/^[1-9][0-9]{0,8}$/.test(versionRaw)) return null;
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signature(`v1.${repId}.${versionRaw}.${expRaw}`, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // After the signature, as in sessionToken.ts: timing says nothing about
  // whether a forged token happened to be in date.
  if (expiresAt <= nowMs) return null;
  return { repId, version: Number(versionRaw) };
}
