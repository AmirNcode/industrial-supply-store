import type { ReactNode } from "react";
import { ErrorBanner } from "./Banners";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * The frame around a draft invoice, shared by the admin's and the rep's draft
 * pages: what a draft is, the document as the customer will receive it, and
 * the actions — Send quote and a way back. Nothing on a draft page writes
 * anything until sending is confirmed. What the customer receives is a quote:
 * no number and no locked rate yet, both of which come later.
 */
export function InvoiceDraft({
  locale,
  changed,
  children,
  actions,
  backorderParts = [],
}: {
  locale: Locale;
  /** A finalize was refused because a rate moved; the figures are fresh. */
  changed: boolean;
  children: ReactNode;
  actions: ReactNode;
  /** Part numbers on back order. The document itself does not mark them, and staff quoting should know which lines are not on the shelf. */
  backorderParts?: string[];
}) {
  const t = getDict(locale);
  return (
    <>
      <p className="mb-3 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
        {t.quoteDraftNotice}
      </p>
      {backorderParts.length > 0 && (
        <p className="mb-3 text-[12px]">
          <strong>{t.backorderTag}:</strong>{" "}
          <span className="tech" dir="ltr">
            {backorderParts.join(", ")}
          </span>
        </p>
      )}
      {changed && <ErrorBanner>{t.invoiceDraftChanged}</ErrorBanner>}
      <div className="invoice-sheet mx-auto mb-4 max-w-[820px] border border-[var(--color-rule)] px-6 py-8">
        {children}
      </div>
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-4">{actions}</div>
    </>
  );
}
