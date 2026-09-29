import type { ReactNode } from "react";
import type { PaymentProof } from "@/db/paymentProofQueries";
import type { ProofUploadResult } from "@/lib/paymentProofUpload";
import { getDict, type Locale } from "@/lib/i18n";
import { PaymentProofList } from "./PaymentProofList";
import { PaymentProofUpload } from "./PaymentProofUpload";

/**
 * Proof of payment on an order page: the upload while payment is owed or
 * being checked, and the receipts already sent. Framed in the brand colour
 * while an upload is wanted, so it reads as the next thing to do rather than
 * one more panel.
 */
export function PaymentProofSection({
  locale,
  proofs,
  upload,
  hint,
  linked = true,
  showUploader = false,
  children,
}: {
  locale: Locale;
  proofs: readonly PaymentProof[];
  /** Absent once the order no longer takes receipts. */
  upload?: (formData: FormData) => Promise<ProofUploadResult>;
  hint?: string;
  /** False on the pay page, whose link does not open receipts. */
  linked?: boolean;
  showUploader?: boolean;
  /** Extra controls, e.g. a rep's Confirm payment. */
  children?: ReactNode;
}) {
  const t = getDict(locale);
  if (!upload && proofs.length === 0 && !children) return null;
  return (
    <section
      id="proof-of-payment"
      aria-labelledby="proof-heading"
      className={`mb-4 grid gap-3 p-3 ${
        upload ? "border-2 border-[var(--color-navy)] bg-[var(--color-navy-tint)]" : "border border-[var(--color-rule)]"
      }`}
    >
      <h2 id="proof-heading" className="text-[14px] font-bold">
        {t.proofTitle}
      </h2>
      {upload && (
        <PaymentProofUpload
          locale={locale}
          upload={upload}
          hasProofs={proofs.length > 0}
          hint={hint ?? t.proofHint}
        />
      )}
      {(proofs.length > 0 || !upload) && (
        <PaymentProofList locale={locale} proofs={proofs} linked={linked} showUploader={showUploader} />
      )}
      {children}
    </section>
  );
}
