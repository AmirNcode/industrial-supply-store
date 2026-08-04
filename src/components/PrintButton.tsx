"use client";

import { getDict, type Locale } from "@/lib/i18n";

/**
 * The whole PDF pipeline.
 *
 * A server-side renderer was considered and rejected: the browser already does
 * Arabic-script shaping and bidi correctly, which is the hard part of a Persian
 * invoice, and it does it with the same fonts the rest of the site ships. The
 * cost is that the customer gets a print dialog rather than a download — which
 * is fine, because in this version staff are the ones producing the PDF.
 */
export function PrintButton({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary no-print">
      {t.invoiceDownload}
    </button>
  );
}
