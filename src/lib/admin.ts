import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEMO_MODE } from "./demo";

/**
 * Single shared password for the local admin view.
 *
 * This is deliberately minimal and is NOT a full staff identity system: there
 * are no named accounts, MFA, revocation, or audit trail. Login attempts are
 * rate-limited at the action boundary, but anything beyond evaluation still
 * needs real staff authentication before this page is broadly exposed.
 */
const COOKIE = "isupply_admin";

/** The value `.env.example` ships, so it is the one people forget to change. */
const DEV_DEFAULT = "changeme";

/**
 * Production refuses the default rather than falling back to it.
 *
 * This page is the order inbox: every customer's company, contact name, email,
 * phone and delivery address, plus invoice issuance, customer password resets,
 * a full price-list export and a bulk overwrite of the catalog. A shipped
 * default password makes all of that world-accessible to anyone who reads the
 * repository, and nothing about the running site looks wrong.
 *
 * Resolved per call rather than at import so this throws when someone opens
 * /admin, not while the site is being built — the build has no business
 * needing the admin credential.
 */
function adminPassword(): string {
  const p = process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && (!p || p === DEV_DEFAULT)) {
    throw new Error(
      "ADMIN_PASSWORD must be set to something other than the example value in production",
    );
  }
  return p || DEV_DEFAULT;
}

function expectedToken(): string {
  return createHmac("sha256", adminPassword()).update("isupply-admin-v1").digest("hex");
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
  if (!safeEqual(password, adminPassword())) return false;
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

/**
 * Every admin Server Action calls this first.
 *
 * `DEMO_MODE` deliberately makes /admin readable with no password so the RFQ
 * inbox can be shown without handing out a credential. That is only defensible
 * while the page is read-only: the same flag on a page that can change order
 * statuses or overwrite the catalog would make those actions world-writable.
 */
export async function assertAdminWrite(): Promise<void> {
  if (DEMO_MODE) throw new Error("Admin is read-only in demo mode");
  if (!(await isAdmin())) throw new Error("Not signed in as admin");
}
