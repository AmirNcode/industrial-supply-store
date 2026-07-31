import type { Locale } from "./i18n";

/**
 * Prices are stored once, in USD cents. Persian display converts to Toman at a
 * rate the caller supplies.
 *
 * The rate is a required argument rather than a module constant read from the
 * environment. Staff can change it from the admin page, and a defaulted
 * parameter would let one forgotten call site keep rendering the old rate —
 * prices that are wrong with no visible symptom. Making it required turns that
 * into a compile error instead.
 */

export function currencyFor(locale: Locale): "USD" | "IRT" {
  return locale === "fa" ? "IRT" : "USD";
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// fa-IR gives Persian digits and the ٬ thousands separator natively.
const tomanFmt = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 0,
});

/**
 * Toman amounts run to six or seven digits, so sub-100 precision is noise.
 * Rounding to the nearest 100 keeps the column narrow and reads as a real price.
 */
function toToman(cents: number, rate: number): number {
  const raw = (cents / 100) * rate;
  return Math.round(raw / 100) * 100;
}

export function formatPrice(cents: number, locale: Locale, rate: number): string {
  if (locale === "fa") return `${tomanFmt.format(toToman(cents, rate))} تومان`;
  return usdFmt.format(cents / 100);
}

/** Bare number, no currency word — for dense table columns with a unit header. */
export function formatPriceBare(cents: number, locale: Locale, rate: number): string {
  if (locale === "fa") return tomanFmt.format(toToman(cents, rate));
  return (cents / 100).toFixed(2);
}

export function currencyLabel(locale: Locale): string {
  return locale === "fa" ? "تومان" : "USD";
}

const intFmtFa = new Intl.NumberFormat("fa-IR");
const intFmtEn = new Intl.NumberFormat("en-US");

/** Counts, quantities — localised digits are correct here, unlike dimensions. */
export function formatInt(n: number, locale: Locale): string {
  return locale === "fa" ? intFmtFa.format(n) : intFmtEn.format(n);
}

/**
 * Spec dimensions stay in Latin digits in both locales. Iranian procurement
 * staff match these against manufacturer catalogs, which are Latin — localising
 * them would make the table harder to use, not easier.
 */
export function formatSpecNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // Trim trailing zeros but keep at least the significant decimals.
  return String(Number(v.toFixed(4)));
}
