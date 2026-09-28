import { timingSafeEqual } from "node:crypto";

/**
 * Mirrors `orders_pay_token_check`. Checked before any query, so a guessed or
 * mangled link costs a regular expression, not a database round trip.
 */
export function isPayToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function payTokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
