import { latinDigits } from "./digits";

/**
 * A percentage as typed → basis points: "10", "9.5", "۹٫۵", "2,5", "10%".
 * Persian or Latin digits, either decimal mark, an optional percent sign.
 * More than two decimals is refused rather than rounded: a rate typed as
 * 9.125 is a rate someone meant, and printing 9.13 would change every total.
 * One parser for VAT and commission alike (review L-10).
 */
export function parsePercentBp(raw: string, maxBp = 10_000): number | null {
  const value = latinDigits(raw.trim())
    .replace(/[%٪]/g, "")
    .replace(/[٫,]/g, ".")
    .trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= maxBp ? bp : null;
}
