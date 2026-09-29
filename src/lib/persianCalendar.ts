import type { Locale } from "./i18n";

/**
 * The Persian (Solar Hijri) calendar on Tehran time — how Iranian businesses
 * keep their books, and so how a rep's month is counted.
 *
 * Postgres has no Persian calendar, which is why month bucketing happens here
 * and not in SQL. Node's ICU has one (2026-09-26 → 4 Mehr 1405). Month names
 * are fixed below rather than taken from ICU, so English spelling does not
 * change with an ICU upgrade.
 */
const TEHRAN = "Asia/Tehran";

const PERSIAN_PARTS = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

// en-CA writes dates as YYYY-MM-DD, the shape of a Postgres date column.
const GREGORIAN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const faNumber = new Intl.NumberFormat("fa-IR", { useGrouping: false });

const MONTHS_EN = [
  "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
  "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
] as const;
const MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

export type PersianYearMonth = { year: number; month: number };

function persianParts(date: Date): PersianYearMonth & { day: number } {
  const parts = PERSIAN_PARTS.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function persianYearMonth(date: Date): PersianYearMonth {
  const { year, month } = persianParts(date);
  return { year, month };
}

export function persianMonthName(month: number, locale: Locale): string {
  return (locale === "fa" ? MONTHS_FA : MONTHS_EN)[month - 1] ?? "";
}

export function persianMonthLabel(ym: PersianYearMonth, locale: Locale): string {
  const year = locale === "fa" ? faNumber.format(ym.year) : String(ym.year);
  return `${persianMonthName(ym.month, locale)} ${year}`;
}

/** An instant, read on Tehran time: "4 Mehr 1405" / "۴ مهر ۱۴۰۵". */
export function formatPersianDate(value: Date | string, locale: Locale): string {
  const { year, month, day } = persianParts(new Date(value));
  if (locale === "fa") {
    return `${faNumber.format(day)} ${MONTHS_FA[month - 1]} ${faNumber.format(year)}`;
  }
  return `${day} ${MONTHS_EN[month - 1]} ${year}`;
}

/**
 * A calendar day stored as `YYYY-MM-DD` — a follow-up date — is not an
 * instant. Reading it at Tehran noon keeps it on the same day whatever the
 * server's own time zone.
 */
export function formatPersianDay(isoDate: string, locale: Locale): string {
  return formatPersianDate(new Date(`${isoDate}T12:00:00+03:30`), locale);
}

/** Today in Tehran as `YYYY-MM-DD`, for comparing with date columns. */
export function tehranToday(now: Date = new Date()): string {
  return GREGORIAN_DAY.format(now);
}

export function tehranDatePlusDays(days: number, now: Date = new Date()): string {
  const [year, month, day] = tehranToday(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * An invoice's date: the Persian calendar on a Persian invoice, Gregorian
 * `YYYY-MM-DD` on an English one. Both are read on Tehran time, so the two
 * language copies of one invoice name the same day — at UTC an invoice issued
 * after midnight Tehran would print yesterday in English and today in Persian.
 */
export function formatInvoiceDate(value: Date | string, locale: Locale): string {
  return locale === "fa" ? formatPersianDate(value, "fa") : tehranToday(new Date(value));
}
