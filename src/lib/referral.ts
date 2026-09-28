import "server-only";
import { cookies } from "next/headers";
import { isReferralCode } from "./repAccount";

export const REFERRAL_COOKIE = "isupply_ref";
export const REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The code only, unsigned. Forging it can do no more than the rep's own link
 * does — put a new sign-up with that rep — and the rep is re-checked as active
 * when the account is created.
 */
export async function readReferralCode(): Promise<string | null> {
  const value = (await cookies()).get(REFERRAL_COOKIE)?.value ?? "";
  return isReferralCode(value) ? value : null;
}

export async function clearReferralCookie(): Promise<void> {
  (await cookies()).delete(REFERRAL_COOKIE);
}
