import { randomInt } from "node:crypto";
import { latinDigits } from "./digits";

/** Mirrors `users_customer_code_check`. Stored codes are ASCII only. */
export function isCustomerCode(value: string): boolean {
  return /^[0-9]{7}$/.test(value);
}

/** The last seven digits of a phone; spaces, dashes and `+` ignored. */
export function codeFromPhone(phone: string): string | null {
  const digits = latinDigits(phone).replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-7) : null;
}

/** Seven digits without padding, so a random ID never looks like a truncated one. */
export function randomCustomerCode(): string {
  return String(randomInt(1_000_000, 10_000_000));
}

export type LoginIdentifier = { kind: "code"; code: string } | { kind: "email"; email: string };

/**
 * One sign-in field takes either. Seven digits is an ID — no email address is
 * seven bare digits — and anything else is looked up as an email.
 */
export function parseLogin(raw: string): LoginIdentifier | null {
  const value = latinDigits(raw.trim());
  if (value === "") return null;
  if (isCustomerCode(value)) return { kind: "code", code: value };
  return { kind: "email", email: value.toLowerCase() };
}
