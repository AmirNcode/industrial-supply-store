import type { PaymentProof } from "@/db/paymentProofQueries";
import { formatInvoiceDate } from "@/lib/persianCalendar";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/**
 * The receipts on one order, each opening full size in a new tab. `payKey` is
 * for the pay page, whose visitor has no session: the receipt route accepts
 * the same key the page was opened with.
 */
export function PaymentProofList({
  locale,
  proofs,
  payKey,
  showUploader = false,
}: {
  locale: Locale;
  proofs: readonly PaymentProof[];
  payKey?: string;
  /** Staff and reps see who uploaded each one; customers do not need to. */
  showUploader?: boolean;
}) {
  const t = getDict(locale);
  if (proofs.length === 0) {
    return <p className="text-[12px] text-[var(--color-ink-muted)]">{t.proofNone}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-3">
      {proofs.map((proof, index) => {
        const href = `/api/payment-proofs/${proof.id}${payKey ? `?key=${payKey}` : ""}`;
        const label = t.proofReceipt.replace("{n}", formatInt(index + 1, locale));
        return (
          <li key={proof.id} className="w-[132px] text-[11px]">
            <a href={href} target="_blank" rel="noopener noreferrer" className="block">
              {proof.contentType === "application/pdf" ? (
                <span className="flex h-[96px] items-center justify-center border border-[var(--color-rule)] bg-[var(--color-panel-alt)] font-bold">
                  PDF
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- private, access-checked bytes; nothing for the optimiser to cache
                <img
                  src={href}
                  alt={label}
                  loading="lazy"
                  className="h-[96px] w-full border border-[var(--color-rule)] object-cover"
                />
              )}
              <span className="mt-1 block font-semibold">{label}</span>
            </a>
            <span className="block text-[var(--color-ink-muted)]">{formatInvoiceDate(proof.createdAt, locale)}</span>
            {showUploader && (
              <span className="block text-[var(--color-ink-muted)]">
                {proof.uploadedBy === "rep" && proof.repName
                  ? t.proofByRep.replace("{name}", proof.repName)
                  : t.proofByCustomer}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
