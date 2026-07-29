import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DemoBanner } from "@/components/DemoBanner";
import { isLocale, dir, locales, getDict, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Parstech Supply — Industrial Parts",
  description:
    "Industrial parts catalog: fasteners, sealing, bearings, pipe fittings and more.",
};

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
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
        >
          {t.products}
        </a>
        <DemoBanner locale={l} />
        <Header locale={l} />
        <div id="main">{children}</div>
        <Footer locale={l} />
      </body>
    </html>
  );
}
