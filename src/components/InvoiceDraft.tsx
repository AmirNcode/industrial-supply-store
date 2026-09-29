import type { ReactNode } from "react";
import { ErrorBanner } from "./Banners";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * The frame around a draft invoice, shared by the admin's and the rep's draft
 * pages: what a draft is, the document as the customer will receive it, and
 * the actions — Finalize and a way back. Nothing on a draft page writes
 * anything until Finalize is confirmed.
 */
export function InvoiceDraft({
  locale,
  changed,
  children,
  actions,
}: {
  locale: Locale;
  /** A finalize was refused because a rate moved; the figures are fresh. */
  changed: boolean;
  children: ReactNode;
  actions: ReactNode;
}) {
  const t = getDict(locale);
  return (
    <>
      <p className="mb-3 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
        {t.invoiceDraftNotice}
      </p>
      {changed && <ErrorBanner>{t.invoiceDraftChanged}</ErrorBanner>}
      <div className="invoice-sheet mx-auto mb-4 max-w-[820px] border border-[var(--color-rule)] px-6 py-8">
        {children}
      </div>
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-4">{actions}</div>
    </>
  );
}
