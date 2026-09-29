import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_MODE } from "./demo";
import { AUTH_SECRET } from "./authSecret";
import {
  ADMIN_SESSION_TTL_MS,
  passwordsEqual,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "./adminSessionToken";
import { sql } from "@/db";
import type { Locale } from "./i18n";

/**
 * Single shared password for the local admin view.
 *
 * This is deliberately minimal and is NOT a full staff identity system: there
 * are no named accounts, MFA or audit trail. Sessions expire after eight
 * hours, end when the password changes, and "Sign out everywhere" revokes
 * them all. Login attempts are rate-limited at the action boundary, but
 * anything beyond evaluation still needs real staff authentication before
 * this page is broadly exposed.
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

/**
 * The admin session version (`app_settings`). "Sign out everywhere" bumps it,
 * and every cookie carrying the old one stops verifying. Missing reads as 1.
 */
const KEY_SESSION_VERSION = "admin_session_version";

async function sessionVersion(): Promise<number> {
  const [row] = await sql<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${KEY_SESSION_VERSION}
  `;
  const version = Number(row?.value);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

/**
 * Cached per request: a page and the actions it calls ask more than once, and
 * each answer costs one settings read. The token itself is checked for
 * signature, expiry and version (`adminSessionToken.ts`).
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  return verifyAdminSessionToken(token, AUTH_SECRET, adminPassword(), await sessionVersion());
});

export async function signInAdmin(password: string): Promise<boolean> {
  if (!passwordsEqual(password, adminPassword())) return false;
  const jar = await cookies();
  jar.set(
    COOKIE,
    signAdminSessionToken(
      await sessionVersion(),
      Date.now() + ADMIN_SESSION_TTL_MS,
      AUTH_SECRET,
      adminPassword(),
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      // Sent only over HTTPS in production, like the customer and rep cookies.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    },
  );
  return true;
}

/**
 * Ends every admin session, this one included: the shared password means a
 * copied cookie cannot be told apart from a colleague's, so this is the only
 * way to revoke one.
 */
export async function signOutAllAdmins(): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY_SESSION_VERSION}, '2', now())
    ON CONFLICT (key) DO UPDATE
      SET value = (COALESCE(NULLIF(app_settings.value, '')::int, 1) + 1)::text, updated_at = now()
  `;
  (await cookies()).delete(COOKIE);
}

export async function signOutAdmin(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Every admin page calls this first, before it reads anything.
 *
 * The panel layout's own check is not enough. Next renders a route's page
 * independently of its layout, so while the layout's `redirect()` set the 307,
 * the page under it still ran its queries and streamed its output into the
 * same response: every order's contact details, pay links and staff notes went
 * to anyone who requested the URL — invisible in a browser, which follows the
 * redirect, and readable by anything that does not. The check therefore sits
 * in the page, ahead of its first query. `src/lib/adminGate.test.ts` fails the
 * build's tests if a panel page forgets it.
 *
 * `DEMO_MODE` reads as signed in, as it does in the layout: the demo's panel
 * is public on purpose, and every write still refuses it (`assertAdminWrite`).
 */
export async function requireAdmin(locale: Locale): Promise<void> {
  if (DEMO_MODE) return;
  if (!(await isAdmin())) redirect(`/${locale}/admin/login`);
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
