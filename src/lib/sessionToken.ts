import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed cookie, not a sessions table.
 *
 * One table fewer, no expiry sweep, and the same shape `lib/admin.ts` already
 * uses. The accepted cost is that an individual session cannot be revoked:
 * signing out clears the cookie on that device, and invalidating everything
 * everywhere means rotating `AUTH_SECRET`. At this scale that is the right
 * trade, and swapping in a `sessions` table later changes only `session.ts`.
 *
 * Kept free of `next/headers` so it can be tested without a request.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSessionToken(
  userId: string,
  expiresAtMs: number,
  secret: string,
): string {
  const payload = `${userId}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret)}`;
}

/** Returns the user id, or null for anything tampered with, expired or malformed. */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, provided] = parts;
  if (!userId) return null;

  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signature(`${userId}.${expRaw}`, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Checked after the signature, so an attacker learns nothing from timing
  // about whether a forged token happened to be in date.
  if (expiresAt <= nowMs) return null;

  return userId;
}
