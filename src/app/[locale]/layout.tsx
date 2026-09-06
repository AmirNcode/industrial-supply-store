import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DemoBanner } from "@/components/DemoBanner";
import { CartSync } from "@/components/CartSync";
import { Analytics } from "@vercel/analytics/next";
import { isLocale, dir, locales, getDict, type Locale } from "@/lib/i18n";

/**
 * TEMPORARY — Enamad ownership check for temex.ir, required before the payment
 * gateway will activate. Enamad fetches the home page and accepts any one of
 * three proofs; all three are in place so the check cannot fail on whichever one
 * it happens to read. They are the number in the title below, the `enamad` meta
 * tag below, and `public/25626502.txt`, served at the site root.
 *
 * The title marker is public: it shows in the browser tab, in search results and
 * in link previews for as long as it is here. Remove the `— 25626502` suffix, the
 * `other` entry and `public/25626502.txt` once the seal is issued.
 */
export const metadata: Metadata = {
  title: "TEMEX — Tools, Equipment & Materials Express — 25626502",
  description:
    "Industrial parts catalog: fasteners, sealing, bearings, pipe fittings and more.",
  other: { enamad: "25626502" },
};

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
        <DemoBanner locale={l} />
        <Header locale={l} />
        <div id="main">{children}</div>
        <Footer locale={l} />
        {/* Renders no markup — injects the script that reports page views. The
            `/next` entry point rather than `/react` so routes are reported as
            `/[locale]/f/[slug]` rather than one row per part family. This is
            the layout that owns <html>/<body>, so it is the root layout in the
            sense the docs mean. */}
        <Analytics />
      </body>
    </html>
  );
}
