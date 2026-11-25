import { locales, type Locale } from "./locale";

/**
 * The domain each language is published on. Both are www.temex.ir for now
 * (owner's decision, 2026-11-24); temexpro.com is held back for other markets
 * and redirects here on Vercel.
 *
 * Until then both domains served the whole site, and Google had indexed every
 * page twice, once per domain, with the two copies competing against each
 * other. Anything that tells a search engine where a page lives — the sitemap,
 * and later canonical and language links — takes the address from here, so a
 * future market domain is a change to this map, not a hunt through the code.
 *
 * The `www.` form is the one the bare domain redirects to on Vercel; naming
 * the redirecting form would send crawlers through an extra hop on every URL.
 */
export const LOCALE_ORIGIN: Record<Locale, string> = {
  fa: "https://www.temex.ir",
  en: "https://www.temex.ir",
};

/** Absolute address of a site path in the given language, on that language's domain. */
export function localeUrl(locale: Locale, path: string = ""): string {
  const tail = path.replace(/^\/+/, "");
  return `${LOCALE_ORIGIN[locale]}/${locale}${tail ? `/${tail}` : ""}`;
}

export type SitemapCatalog = {
  /** Category paths, e.g. `fasteners/bolts`. */
  categoryPaths: string[];
  familySlugs: string[];
};

export type SitemapEntry = {
  url: string;
  alternates: { languages: Record<string, string> };
};

/**
 * One language's sitemap: the home page, every category and every family,
 * each pointing at its twin in the other language.
 *
 * The language links are what keeps Google from treating /fa/f/x and /en/f/x
 * as unrelated pages that happen to share a layout. `x-default` (the page for
 * a searcher whose language is neither) is the Persian one, since the buyers
 * are in Iran.
 *
 * Paths are the bare pages only: filtered family views and list pages past the
 * first are barred in robots.txt, and listing them here would contradict it.
 */
export function sitemapEntries(locale: Locale, catalog: SitemapCatalog): SitemapEntry[] {
  const paths = [
    "",
    ...catalog.categoryPaths.map((p) => `c/${p}`),
    ...catalog.familySlugs.map((s) => `f/${s}`),
  ];
  return paths.map((path) => {
    const languages: Record<string, string> = {};
    for (const l of locales) languages[l] = localeUrl(l, path);
    languages["x-default"] = localeUrl("fa", path);
    return { url: localeUrl(locale, path), alternates: { languages } };
  });
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap document for `sitemapEntries`, with each page's language links. */
export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const links = Object.entries(e.alternates.languages)
      .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${xmlEscape(href)}" />`)
      .join("\n");
    return `<url>\n<loc>${xmlEscape(e.url)}</loc>\n${links}\n</url>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}
