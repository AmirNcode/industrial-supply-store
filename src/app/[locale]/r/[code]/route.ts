import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { isReferralCode } from "@/lib/repAccount";
import { getActiveRepByReferralCode } from "@/db/repQueries";
import { REFERRAL_COOKIE, REFERRAL_TTL_SECONDS } from "@/lib/referral";

// The same ceiling every API route carries since the 2026-08-15 incident.
export const maxDuration = 60;

/**
 * A rep's marketing link. Opening it remembers the rep for 30 days and lands
 * on the catalog; whoever signs up within that time becomes the rep's
 * customer. The latest link opened wins. An unknown or deactivated rep's code
 * is ignored rather than remembered.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; code: string }> },
) {
  const { locale, code } = await params;
  const target = isLocale(locale) ? locale : defaultLocale;
  const normalized = code.toUpperCase();
  if (isReferralCode(normalized) && (await getActiveRepByReferralCode(normalized))) {
    (await cookies()).set(REFERRAL_COOKIE, normalized, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_TTL_SECONDS,
    });
  }
  redirect(`/${target}`);
}
