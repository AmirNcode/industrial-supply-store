/**
 * One-time sign-in codes: the rules, with no database in them.
 *
 * Six digits, ten minutes, five wrong tries per code. Only an HMAC of the code
 * is stored, keyed with the server secret and bound to the account, so a copy
 * of the table gives away no usable code and a code for one account can never
 * match another's row.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { latinDigits } from "./digits";

export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/**
 * A code this fresh is not replaced when another is asked for. Each request
 * used to kill the code before it, so anyone who knew a customer's email could
 * ask every few minutes and the customer's own code never worked (review
 * R-20). Two minutes is time to open the email and type six digits; the code
 * already in the inbox is still the one that counts, so nothing new is sent.
 */
export const LOGIN_CODE_KEEP_SECONDS = 120;

/** Uniform over 000000–999999, leading zeros kept. */
export function newLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Persian or Arabic digits and stray spaces are accepted; anything else is not a code. */
export function normalizeLoginCode(raw: string): string | null {
  const digits = latinDigits(raw).replace(/[\s-]/g, "");
  return /^[0-9]{6}$/.test(digits) ? digits : null;
}

export function hashLoginCode(userId: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`isupply-login-code-v1.${userId}.${code}`).digest("hex");
}

export function loginCodeMatches(userId: string, code: string, storedHash: string, secret: string): boolean {
  const a = Buffer.from(hashLoginCode(userId, code, secret));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
