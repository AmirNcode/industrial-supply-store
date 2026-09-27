import { randomInt } from "node:crypto";
import { latinDigits } from "./digits";
import type { Locale } from "./i18n";

/** The order-reference alphabet: no O/0 or I/1, because these are read aloud. */
const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Quick follow-up choices, in days from today in Tehran. */
export const FOLLOW_UP_DAYS = [1, 3, 7, 14, 30] as const;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Mirrors `sales_reps_username_check`. */
export function isValidUsername(value: string): boolean {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}

/**
 * "2.5" → 250 basis points. At most two decimals and 0–100; Persian digits,
 * the Persian decimal separator ٫ and a trailing % or ٪ are accepted. A third
 * decimal is refused rather than rounded: a rate someone typed and a rate the
 * system stored must be the same number.
 */
export function parseCommissionPercent(raw: string): number | null {
  const value = latinDigits(raw.trim()).replace("٫", ".").replace(/[%٪]$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 250 → "2.5". What a form is prefilled with, so saving it unchanged is a no-op. */
export function formatCommissionPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const percentFormat = {
  en: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  fa: new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }),
} as const;

export function commissionPercentLabel(bp: number, locale: Locale): string {
  const n = percentFormat[locale].format(bp / 100);
  return locale === "fa" ? `${n}٪` : `${n}%`;
}

export function randomReferralCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return out;
}

/** Mirrors `sales_reps_referral_code_check`. */
export function isReferralCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(value);
}
