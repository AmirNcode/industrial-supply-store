import "server-only";
import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";
import { getUserById, type UserRow } from "@/db/userQueries";
import { AUTH_SECRET } from "./authSecret";

const COOKIE = "isupply_session";

export async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSessionToken(userId, Date.now() + SESSION_TTL_MS, AUTH_SECRET), {
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
  return verifySessionToken(token, AUTH_SECRET);
}

export async function currentUser(): Promise<UserRow | null> {
  const id = await currentUserId();
  if (!id) return null;
  return getUserById(id);
}
