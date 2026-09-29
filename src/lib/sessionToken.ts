import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed cookie, not a sessions table.
 *
 * One table fewer and no expiry sweep. It carries the account's
 * `users.session_version`, which `currentUserId()` re-reads on every request
 * and every password change or reset increments — so changing a password, or
 * a reset by the admin or a rep, ends every other open session at once
 * instead of leaving them alive for 30 days (review finding M-2). The same
 * rule the rep cookie already had.
 *
 * A cookie issued before versions existed (`userId.expiry.sig`) reads as
 * version 1, which every account starts at: nobody is signed out by the
 * deploy, and the first password change still revokes it.
 *
 * Kept free of `next/headers` so it can be tested without a request.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSessionToken(
  userId: string,
  expiresAtMs: number,
  secret: string,
  version: number = 1,
): string {
  const payload = `${userId}.${version}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret)}`;
}

export type SessionClaim = { userId: string; version: number };

/** The claim, or null for anything tampered with, expired or malformed. */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): SessionClaim | null {
  const parts = token.split(".");
  let userId: string, versionRaw: string, expRaw: string, provided: string, payload: string;
  if (parts.length === 4) {
    [userId, versionRaw, expRaw, provided] = parts;
    if (!/^[1-9][0-9]{0,8}$/.test(versionRaw)) return null;
    payload = `${userId}.${versionRaw}.${expRaw}`;
  } else if (parts.length === 3) {
    [userId, expRaw, provided] = parts;
    versionRaw = "1";
    payload = `${userId}.${expRaw}`;
  } else {
    return null;
  }
  if (!UUID_PATTERN.test(userId)) return null;

  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signature(payload, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Checked after the signature, so an attacker learns nothing from timing
  // about whether a forged token happened to be in date.
  if (expiresAt <= nowMs) return null;

  return { userId, version: Number(versionRaw) };
}
