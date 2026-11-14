"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { systemText } from "@/lib/i18nSystem";

/**
 * What a visitor sees when a page under a language fails while rendering —
 * most often the database not answering in time. It keeps the header and
 * footer, speaks the page's language and offers a retry, where the framework's
 * default was a bare English line (review R-9). The error's own text is never
 * shown: in production Next replaces it with a reference number anyway.
 */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  const { locale, t } = systemText(useParams().locale);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[560px] px-3 pt-8 pb-16">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.errorTitle}
      </h1>
      <p role="alert" className="mb-4 text-[12px] text-[var(--color-ink-muted)]">
        {t.errorBody}
      </p>
      <div className="flex flex-wrap items-center gap-4 text-[12px]">
        <button type="button" className="btn-primary" onClick={() => retry()}>
          {t.errorRetry}
        </button>
        <Link href={`/${locale}`} className="underline">
          {t.toHome}
        </Link>
      </div>
    </main>
  );
}
