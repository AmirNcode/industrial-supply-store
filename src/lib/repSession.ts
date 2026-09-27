import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_SECRET } from "./authSecret";
import { REP_SESSION_TTL_MS, signRepSessionToken, verifyRepSessionToken } from "./repSessionToken";
import { getRepById, type RepRow } from "@/db/repQueries";
import type { Locale } from "./i18n";

const COOKIE = "isupply_rep";

export async function setRepSessionCookie(rep: { id: string; sessionVersion: number }): Promise<void> {
  const jar = await cookies();
  jar.set(
    COOKIE,
    signRepSessionToken(rep.id, rep.sessionVersion, Date.now() + REP_SESSION_TTL_MS, AUTH_SECRET),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(REP_SESSION_TTL_MS / 1000),
    },
  );
}

export async function clearRepSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in rep, re-read from the database on every request.
 *
 * The cookie proves who signed in; only the row can say whether they still
 * may. A deactivated rep, or a cookie minted before the last password change,
 * reads as signed out — the gap customers' cookies still have does not exist
 * here. `cache` lets a layout and its page share the one read.
 */
export const currentRep = cache(async (): Promise<RepRow | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const claim = verifyRepSessionToken(token, AUTH_SECRET);
  if (!claim) return null;
  const rep = await getRepById(claim.repId);
  if (!rep || !rep.active || rep.sessionVersion !== claim.version) return null;
  return rep;
});

/** Portal pages and rep actions: signed in, and past any forced password change. */
export async function requireRep(locale: Locale): Promise<RepRow> {
  const rep = await currentRep();
  if (!rep) redirect(`/${locale}/rep/signin`);
  if (rep.mustChangePassword) redirect(`/${locale}/rep/password`);
  return rep;
}

/** The password page, which a temporary password must still be able to reach. */
export async function requireRepSession(locale: Locale): Promise<RepRow> {
  const rep = await currentRep();
  if (!rep) redirect(`/${locale}/rep/signin`);
  return rep;
}
