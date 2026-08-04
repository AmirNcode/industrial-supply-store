import "server-only";
import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";
import { getUserById, type UserRow } from "@/db/userQueries";

const COOKIE = "isupply_session";

/**
 * A predictable signing key means anyone can mint a cookie for any user id, so
 * production refuses to start without one rather than falling back to a value
 * that is in the repository.
 */
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production (16+ characters)");
  }
  console.warn("⚠  AUTH_SECRET unset — using a development-only key");
  return "development-only-insecure-key";
}

export async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSessionToken(userId, Date.now() + SESSION_TTL_MS, secret()), {
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

export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, secret());
}

export async function currentUser(): Promise<UserRow | null> {
  const id = await currentUserId();
  if (!id) return null;
  return getUserById(id);
}
