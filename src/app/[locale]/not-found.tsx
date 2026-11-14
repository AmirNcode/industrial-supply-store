"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { systemText } from "@/lib/i18nSystem";

/**
 * Shown inside the site's own header and footer whenever a page calls
 * `notFound()`, and — through the catch-all beside this file — for any address
 * under a language that matches no page. Before this the visitor got the
 * framework's bare English page with no way back (review R-9).
 *
 * A browser component only because Next hands a not-found page no parameters:
 * the language has to be read from the address with `useParams`.
 */
export default function NotFound() {
  const { locale, t } = systemText(useParams().locale);
  return (
    <main className="mx-auto max-w-[560px] px-3 pt-8 pb-16">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.notFoundTitle}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.notFoundBody}</p>
      <div className="flex flex-wrap items-center gap-4 text-[12px]">
        <Link href={`/${locale}`} className="btn-primary inline-block">
          {t.toHome}
        </Link>
        <Link href={`/${locale}/search`} className="underline">
          {t.toSearch}
        </Link>
      </div>
    </main>
  );
}
