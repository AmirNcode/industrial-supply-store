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

/**
 * Exact conversion, no rounding to the nearest 100.
 *
 * `formatPrice` rounds Toman to the nearest hundred because a catalog column
 * of seven-digit numbers is unreadable otherwise. An invoice cannot afford
 * that: rounding each line independently and the total once lets the column
 * disagree with its own sum. At a rate of 145,000, three lines of 33 cents
 * each print 47,900 — 143,700 together — against a total of 143,600. A
 * hundred-Toman gap between a column and its own total is the first thing a
 * reader checks. Here the arithmetic has to close.
 */
export function formatPriceExact(cents: number, locale: Locale, rate: number): string {
  if (locale === "fa") {
    return `${tomanFmt.format(Math.round((cents / 100) * rate))} تومان`;
  }
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

/**
 * Whether a product has no catalog price and should say so.
 *
 * Zero is the importer's default for a blank price column, and a supplier file
 * routinely arrives priced at nothing because pricing happens on the phone.
 * Rendering that as $0.00 would advertise free goods; every price site asks
 * this first and prints "call for price" instead.
 *
 * Negative cannot occur — the parser refuses it — but it is included so a bad
 * row that somehow reached the database reads as "ask us" rather than as a
 * discount.
 */
export function isPriceOnRequest(cents: number): boolean {
  return cents <= 0;
}

// ---------------------------------------------------------------------------
// Explicit currency
// ---------------------------------------------------------------------------

/**
 * Everywhere else in the app, currency follows locale: a Persian page shows
 * Toman, an English page shows dollars. That is right for the catalog, where
 * the reader and the price belong to the same context.
 *
 * An invoice is the exception. A buyer in Tehran may want the document in
 * Persian to read and forward internally, but priced in dollars because that is
 * what the contract says — or the reverse, an English document a foreign
 * office can read priced in the Toman the customer will actually pay. So the
 * invoice picks the two independently and calls these.
 *
 * Currency chooses the unit; locale still chooses the script. Toman on an
 * English invoice prints in Latin digits, because Persian digits in an
 * otherwise-English document are unreadable to the person it was made for.
 */
export type Currency = "USD" | "IRT";

export function isCurrency(v: string): v is Currency {
  return v === "USD" || v === "IRT";
}

const tomanFmtLatin = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Exact, unrounded — see `formatPriceExact` for why an invoice cannot round. */
export function formatMoneyExact(
  cents: number,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  if (currency === "USD") return usdFmt.format(cents / 100);
  const toman = Math.round((cents / 100) * rate);
  return locale === "fa"
    ? `${tomanFmt.format(toman)} تومان`
    : `${tomanFmtLatin.format(toman)} Toman`;
}

export function currencyLabelFor(currency: Currency, locale: Locale): string {
  if (currency === "USD") return "USD";
  return locale === "fa" ? "تومان" : "Toman";
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
