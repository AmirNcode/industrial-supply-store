import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function QuoteSubmittedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ref } = await searchParams;

  return (
    <main className="mx-auto max-w-[620px] px-3 pt-10 pb-16 text-center">
      <h1 className="text-[21px] font-bold text-[var(--color-catalog-green)]">
        {t.quoteSubmitted}
      </h1>
      {ref && (
        <p className="mt-4 border border-[var(--color-callout-border)] bg-[var(--color-callout-bg)] px-4 py-3 text-[13px]">
          {t.quoteRef}:{" "}
          <strong className="tech text-[17px] tracking-wide">{ref}</strong>
        </p>
      )}
      <p className="mt-4 text-[13px] text-[var(--color-ink-muted)]">{t.quoteNext}</p>
      <p className="mt-6">
        <Link href={`/${l}`} className="btn-primary inline-block hover:no-underline">
          {t.backToCatalog}
        </Link>
      </p>
    </main>
  );
}
