import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DemoBanner } from "@/components/DemoBanner";
import { CartSync } from "@/components/CartSync";
import { CartNotice } from "@/components/CartNotice";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { formatInt } from "@/lib/money";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import {
  STATS_BEFORE_SEND,
  STATS_BEFORE_SEND_JS,
  STATS_DOMAINS,
  STATS_RECORDER_LOADER_JS,
  STATS_WEBSITE_ID,
} from "@/lib/statsTracker";
import { isLocale, dir, locales, getDict, type Locale } from "@/lib/i18n";

/**
 * The Enamad ownership proofs — a number in this title, an `enamad` meta tag
 * and a file at the site root — were removed once the seal was issued (review
 * L-3): the title number showed in every browser tab and search result. The
 * seal itself is in the footer and needs none of them.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  // In the page's language: the tab title and the search-result snippet were
  // English on the Persian pages (review R-30).
  const { locale } = await params;
  const t = getDict(isLocale(locale) ? locale : "en");
  // Catalog pages set their own title (`lib/pageMeta.ts`); the template adds
  // the brand so it is never repeated by hand or forgotten.
  return {
    title: { default: `${t.brand} — ${t.tagline}`, template: `%s | ${t.brand}` },
    description: t.metaDescription,
  };
}

/**
 * Hard ceiling on every page and Server Action under this layout. The platform
 * default is 300s, and the 2026-08-15 incident showed what that buys: a request
 * wedged behind a starved connection pool hangs for five minutes before anyone
 * — user or log — learns anything. The slowest legitimate page (the largest
 * unpaginated family) renders in well under 2s, so 60s is not a budget any real
 * request uses; it is how fast a wedged one turns into an error we can see.
 * Route handlers under /api do not inherit this and carry their own.
 */
export const maxDuration = 60;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  return (
    <html lang={l} dir={dir(l)}>
      <body>
        {/* Skip link — the spec tables are long and keyboard users should not
            have to tab through the whole category rail to reach them. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2 no-print"
        >
          {t.products}
        </a>
        <CartSync />
        <CartNotice
          messages={{
            full: t.cartFailFull.replace("{max}", formatInt(REQUEST_LIMITS.cartLines, l)),
            busy: t.cartFailBusy,
            failed: t.cartFailGeneric,
          }}
          dismissLabel={t.cartFailDismiss}
        />
        <DemoBanner locale={l} />
        <Header locale={l} />
        <div id="main">{children}</div>
        <Footer locale={l} />
        {/* Renders no markup — injects the script that reports page views. The
            `/next` entry point rather than `/react` so routes are reported as
            `/[locale]/f/[slug]` rather than one row per part family. This is
            the layout that owns <html>/<body>, so it is the root layout in the
            sense the docs mean. */}
        {/* Vercel serves the script; anywhere else it 404s on every page (L-14). */}
        {process.env.VERCEL ? <Analytics /> : null}
        {/* Visitor statistics (lib/statsTracker.ts). The filter must exist
            before the tracker runs, so it is inline and loads first; the
            tracker reports only from www.temex.ir (`data-domains`). */}
        {STATS_WEBSITE_ID ? (
          <>
            <Script id="stats-filter" strategy="afterInteractive">
              {STATS_BEFORE_SEND_JS}
            </Script>
            <Script
              src="/stats/script.js"
              strategy="afterInteractive"
              data-website-id={STATS_WEBSITE_ID}
              data-domains={STATS_DOMAINS}
              data-exclude-hash="true"
              data-performance="true"
              data-before-send={STATS_BEFORE_SEND}
            />
            {/* Session replays and heatmaps; starts only after the tracker,
                whose visit it joins, and never on staff pages. */}
            <Script id="stats-recorder" strategy="lazyOnload">
              {STATS_RECORDER_LOADER_JS}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
