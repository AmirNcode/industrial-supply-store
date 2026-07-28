import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Single shared password for the local admin view.
 *
 * This is deliberately minimal and is NOT an authentication system: there are no
 * accounts, no rate limiting, and no audit trail. It exists so a demo of the RFQ
 * inbox is not world-readable on a shared network. Anything beyond local
 * evaluation needs real auth before this page is exposed.
 */
const COOKIE = "isupply_admin";

function expectedToken(): string {
  const secret = process.env.ADMIN_PASSWORD ?? "changeme";
  return createHmac("sha256", secret).update("isupply-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, expectedToken());
}

export async function signInAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD ?? "changeme";
  if (!safeEqual(password, expected)) return false;
  const jar = await cookies();
  jar.set(COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return true;
}

export async function signOutAdmin(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
