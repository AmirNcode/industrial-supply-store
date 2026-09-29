import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";
import { getSessionVersion, getUserById, type UserRow } from "@/db/userQueries";
import { AUTH_SECRET } from "./authSecret";

const COOKIE = "isupply_session";

/**
 * Signed with the account's current session version, read here rather than
 * passed in, so a caller that just changed the password (and so bumped the
 * version) cannot hand in the stale one and sign itself out.
 */
export async function setSessionCookie(userId: string): Promise<void> {
  const version = (await getSessionVersion(userId)) ?? 1;
  const jar = await cookies();
  jar.set(COOKIE, signSessionToken(userId, Date.now() + SESSION_TTL_MS, AUTH_SECRET, version), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * The signed-in customer's id, or null — including for a cookie minted before
 * the account's last password change or reset (review M-2). One small read
 * per request, shared by everything that asks (`cache`).
 */
export const currentUserId = cache(async (): Promise<string | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const claim = verifySessionToken(token, AUTH_SECRET);
  if (!claim) return null;
  return (await getSessionVersion(claim.userId)) === claim.version ? claim.userId : null;
});

export async function currentUser(): Promise<UserRow | null> {
  const id = await currentUserId();
  if (!id) return null;
  return getUserById(id);
}
