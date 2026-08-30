import type { Locale } from "./i18n";

/** Product prices are stored once, in USD cents. */
export type Currency = "USD" | "IRR";

/**
 * Which currency customers see across the catalog, cart, quote and account.
 *
 * `both` intentionally does not print two prices beside every product. It
 * preserves the site's language-driven behaviour: English shows USD and
 * Persian shows Rial. Issued invoices are the one place where a customer may
 * switch between the two while this mode is active.
 */
export const PRICE_DISPLAY_MODES = ["usd", "irr", "both"] as const;
export type PriceDisplayMode = (typeof PRICE_DISPLAY_MODES)[number];
export const DEFAULT_PRICE_DISPLAY_MODE: PriceDisplayMode = "irr";

export function isPriceDisplayMode(value: string): value is PriceDisplayMode {
  return (PRICE_DISPLAY_MODES as readonly string[]).includes(value);
}

export function isCurrency(value: string): value is Currency {
  return value === "USD" || value === "IRR";
}

/** Resolve the single currency shown on ordinary customer-facing pages. */
export function customerCurrencyFor(
  mode: PriceDisplayMode,
  locale: Locale,
): Currency {
  if (mode === "usd") return "USD";
  if (mode === "irr") return "IRR";
  return locale === "fa" ? "IRR" : "USD";
}

/**
 * Resolve an invoice currency without letting a query parameter bypass the
 * admin setting. A requested currency is honoured only when both are enabled.
 */
export function invoiceCurrencyFor(
  mode: PriceDisplayMode,
  locale: Locale,
  requested?: string,
): Currency {
  const candidate = String(requested ?? "").toUpperCase();
  if (mode === "both" && isCurrency(candidate)) return candidate;
  return customerCurrencyFor(mode, locale);
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// fa-IR gives Persian digits and the ٬ thousands separator natively.
const rialFmtFa = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const rialFmtEn = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function rialNumber(value: number, locale: Locale): string {
  return locale === "fa" ? rialFmtFa.format(value) : rialFmtEn.format(value);
}

function rialWithUnit(value: number, locale: Locale): string {
  return locale === "fa"
    ? `${rialNumber(value, locale)} ریال`
    : `${rialNumber(value, locale)} IRR`;
}

/**
 * Catalog Rial amounts run to seven or eight digits, so sub-1,000 precision is
 * visual noise. Invoices use the exact formatter below and never take this
 * rounding path.
 */
function toCatalogRial(cents: number, rate: number): number {
  const raw = (cents / 100) * rate;
  return Math.round(raw / 1_000) * 1_000;
}

/**
 * Format a catalog/account amount in an explicit currency. The rate remains a
 * required argument even for USD so a forgotten pricing context is a compile
 * error rather than a page silently falling back to another exchange rate.
 */
export function formatPrice(
  cents: number,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  if (currency === "USD") return usdFmt.format(cents / 100);
  return rialWithUnit(toCatalogRial(cents, rate), locale);
}

/** Exact conversion to a whole Rial, for invoices where catalog rounding is invalid. */
export function formatPriceExact(
  cents: number,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  if (currency === "USD") return usdFmt.format(cents / 100);
  return rialWithUnit(Math.round((cents / 100) * rate), locale);
}

/** Bare number, no currency word — for dense table columns with a unit header. */
export function formatPriceBare(
  cents: number,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  if (currency === "USD") return (cents / 100).toFixed(2);
  return rialNumber(toCatalogRial(cents, rate), locale);
}

export function currencyLabel(currency: Currency, locale: Locale): string {
  if (currency === "USD") return "USD";
  return locale === "fa" ? "ریال" : "IRR";
}

/**
 * Whether a product has no catalog price and should say so.
 *
 * Zero is the importer's default for a blank price column, and a supplier file
 * routinely arrives priced at nothing because pricing happens on the phone.
 * Rendering that as $0.00 would advertise free goods; every price site asks
 * this first and prints "call for price" instead.
 */
export function isPriceOnRequest(cents: number): boolean {
  return cents <= 0;
}

/** Exact invoice formatter; currency and document language are independent. */
export function formatMoneyExact(
  cents: number,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  return formatPriceExact(cents, currency, locale, rate);
}

export function currencyLabelFor(currency: Currency, locale: Locale): string {
  return currencyLabel(currency, locale);
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
  return String(Number(v.toFixed(4)));
}
