import type { Locale } from "./i18n";
import { latinDigits } from "./digits";

/**
 * VAT (ارزش افزوده) as the admin types it and as an invoice prints it.
 *
 * Stored in basis points — 10% is 1,000 — for the same reason commission is:
 * an integer column cannot drift, and a rate like 9.5% still fits exactly.
 * The rate is locked onto each order when its invoice is finalized
 * (`orders.vat_rate_bp`), so changing the setting never restates an invoice
 * already sent.
 */
export const MAX_VAT_RATE_BP = 10_000;

/**
 * "10", "9.5", "۹٫۵", "10%" → basis points. Persian or Latin digits, either
 * decimal mark, an optional percent sign. More than two decimals is refused
 * rather than rounded: a rate someone typed as 9.125 is a rate they meant, and
 * silently printing 9.13 would put a different tax on every invoice.
 */
export function parseVatPercent(raw: string): number | null {
  const value = latinDigits(raw.trim())
    .replace(/[%٪]/g, "")
    .replace(/[٫,]/g, ".")
    .trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= MAX_VAT_RATE_BP ? bp : null;
}

const percentFmt = {
  en: new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }),
  fa: new Intl.NumberFormat("fa-IR", { style: "percent", maximumFractionDigits: 2 }),
};

/** "10%" / "۱۰٪" — the label beside the VAT line. */
export function formatVatPercent(bp: number, locale: Locale): string {
  return percentFmt[locale].format(bp / 10_000);
}

/** The settings field's value: Latin digits, no percent sign, "9.5" not "9.50". */
export function vatPercentInput(bp: number): string {
  return String(bp / 100);
}
