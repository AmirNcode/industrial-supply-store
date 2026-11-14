/**
 * Which languages exist and how to move between them. No wording lives here:
 * that is `i18n.ts`, which browser code must not import (see `clientText.ts`).
 */
export const locales = ["en", "fa"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fa";

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v);
}

/**
 * Used by every action that redirects to a locale-prefixed path: the posted
 * `locale` value reaches `redirect()` unchanged, so a `locale` of `/evil.com`
 * would make that `//evil.com/admin` — a protocol-relative URL, and an open
 * redirect. Anything unrecognised falls back to the default language.
 */
export function safeLocale(formData: FormData): Locale {
  const raw = String(formData.get("locale") ?? "");
  return isLocale(raw) ? raw : defaultLocale;
}

export function dir(locale: Locale): "ltr" | "rtl" {
  return locale === "fa" ? "rtl" : "ltr";
}

/**
 * The same page in the other language.
 *
 * Every route is `/[locale]/…`, so switching language is swapping one segment.
 * The header used to link at `/fa` outright, which threw away whatever the
 * reader was looking at and dropped them back on the catalog — worst on the
 * pages where the switch is most useful, like a filtered family listing or an
 * invoice.
 *
 * A path with no recognised locale segment has nowhere better to go than that
 * language's home.
 */
export function swapLocale(pathname: string, to: Locale): string {
  const segments = pathname.split("/");
  if (segments.length > 1 && isLocale(segments[1])) {
    segments[1] = to;
    return segments.join("/");
  }
  return `/${to}`;
}

/** Picks the locale-appropriate field off a row carrying `<field>En` / `<field>Fa`. */
export function pick<T extends Record<string, unknown>>(
  row: T,
  base: string,
  locale: Locale,
): string {
  const key = locale === "fa" ? `${base}Fa` : `${base}En`;
  const val = row[key];
  if (typeof val === "string" && val.length > 0) return val;
  const fallback = row[`${base}En`];
  return typeof fallback === "string" ? fallback : "";
}
