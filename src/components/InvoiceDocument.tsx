import type { InvoiceItem, InvoiceParty } from "@/db/invoiceQueries";
import type { Seller } from "@/lib/seller";
import { groupInFours, type BankDetails } from "@/lib/bankDetails";
import { invoiceAmounts, lineTotalCents, subtotalCents } from "@/lib/invoice";
import { formatInvoiceDate } from "@/lib/persianCalendar";
import { formatVatPercent } from "@/lib/vat";
import { getDict, type Locale } from "@/lib/i18n";
import { formatAmount, formatInt, formatMoneyExact, type Currency } from "@/lib/money";

/**
 * The invoice as the customer receives it: the issued document, and the draft
 * the admin or a rep checks before finalizing. One component so the draft
 * cannot drift from what is actually sent.
 *
 * Every figure is exact — no catalog rounding — or a column of lines disagrees
 * with its own total. The subtotal row is summed from the lines while VAT and
 * the total come from `totalCents`, which for an issued invoice is the stored
 * `orders.total_cents`; if the two ever disagree the page shows it rather than
 * rounding it away.
 */
export function InvoiceDocument({
  locale,
  seller,
  order,
  items,
  totalCents,
  currency,
  rate,
  vatRateBp,
  invoiceNumber,
  date,
  cancelled = false,
  bank = null,
  proofUrl = null,
}: {
  locale: Locale;
  seller: Seller;
  order: InvoiceParty;
  items: readonly InvoiceItem[];
  totalCents: number;
  currency: Currency;
  rate: number;
  /** Null on an invoice issued before VAT existed: no VAT line at all. */
  vatRateBp: number | null;
  /** Null on a draft, which has no number until it is finalized. */
  invoiceNumber: string | null;
  date: Date | string;
  cancelled?: boolean;
  /** The account from Admin → Settings; null when none is saved. */
  bank?: BankDetails | null;
  /**
   * Where to upload the receipt — the order's pay page, which needs no
   * sign-in. Given while payment is owed or being checked; null otherwise.
   */
  proofUrl?: string | null;
}) {
  const t = getDict(locale);
  const subtotal = subtotalCents(items);
  const withVat =
    vatRateBp === null
      ? null
      : {
          lines: invoiceAmounts(subtotal, vatRateBp, currency, rate),
          due: invoiceAmounts(totalCents, vatRateBp, currency, rate),
        };

  return (
    <>
      <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-[var(--color-ink)] pb-4">
        <div>
          <h1 className="text-[26px] font-bold text-[var(--color-navy)]">{t.invoice}</h1>
          {invoiceNumber ? (
            <p className="tech mt-1 text-[15px] font-bold">{invoiceNumber}</p>
          ) : (
            <p className="mt-1 text-[15px] font-bold uppercase tracking-[0.08em] text-[var(--color-danger)]">
              {t.invoiceDraft}
            </p>
          )}
          {cancelled && (
            <p className="mt-1 text-[15px] font-bold text-[var(--color-danger)]">
              {t.invoiceCancelled}
            </p>
          )}
        </div>
        <div className="text-end text-[12px] leading-relaxed">
          {/* The full lockup earns its place here: white paper, printed at a
              size where the wordmark actually reads. `print-color-adjust`
              keeps the yellow when the browser would otherwise drop
              backgrounds from a print. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/temex-logo.svg"
            alt={seller.name}
            width={132}
            height={132}
            className="mb-2 ms-auto block h-[52px] w-[52px]"
            style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
          />
          <p className="font-bold">{seller.name}</p>
          {seller.addressLines.map((line, i) => (
            <p key={i} className="text-[var(--color-ink-muted)]">{line}</p>
          ))}
          <p className="tech text-[var(--color-ink-muted)]">{seller.email}</p>
          <p className="tech text-[var(--color-ink-muted)]">{seller.phone}</p>
          {seller.taxId && (
            <p className="text-[var(--color-ink-muted)]">
              {t.invoiceTaxId}: <span className="tech">{seller.taxId}</span>
            </p>
          )}
        </div>
      </header>

      <section className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            {t.invoiceTo}
          </h2>
          <p className="text-[14px] font-bold">{order.company}</p>
          <p className="text-[12px]">{order.contactName}</p>
          {order.address && <p className="text-[12px]">{order.address}</p>}
          {(order.city || order.country) && (
            <p className="text-[12px]">{[order.city, order.country].filter(Boolean).join(", ")}</p>
          )}
          <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.email}</p>
          {order.phone && (
            <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.phone}</p>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 self-start text-[12px] sm:justify-self-end">
          <dt className="font-bold">{t.invoiceDate}</dt>
          {/* `.tech` sets a left-to-right monospace run, right for 2026-09-28
              and wrong for a Persian date written in words. */}
          <dd className={locale === "fa" ? undefined : "tech"}>{formatInvoiceDate(date, locale)}</dd>
          <dt className="font-bold">{t.invoiceOrderRef}</dt>
          <dd className="tech">{order.ref}</dd>
          {order.poNumber && (
            <>
              <dt className="font-bold">{t.poNumber}</dt>
              <dd className="tech">{order.poNumber}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="invoice-table w-full">
        <thead>
          <tr>
            <th className="text-start">{t.partNumber}</th>
            <th className="text-start">{t.invoiceDescription}</th>
            <th className="num">{t.qty}</th>
            <th className="num">{t.unitPrice}</th>
            <th className="num">{t.invoiceLineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="tech font-semibold">{i.partNumber}</td>
              <td>{i.familyName}</td>
              <td className="num tech tech-num">{formatInt(i.qty, locale)}</td>
              <td className="num tech tech-num">{formatMoneyExact(i.unitPriceCents, currency, locale, rate)}</td>
              <td className="num tech tech-num">
                {formatMoneyExact(lineTotalCents(i), currency, locale, rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-full max-w-[300px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
          <dt>{t.invoiceSubtotal}</dt>
          <dd className="num tech tech-num">
            {withVat
              ? formatAmount(withVat.lines.subtotal, currency, locale)
              : formatMoneyExact(subtotal, currency, locale, rate)}
          </dd>
          {withVat && vatRateBp !== null && (
            <>
              <dt>{t.invoiceVat.replace("{percent}", formatVatPercent(vatRateBp, locale))}</dt>
              <dd className="num tech tech-num">{formatAmount(withVat.due.vat, currency, locale)}</dd>
            </>
          )}
          <dt className="border-t border-[var(--color-ink)] pt-1.5 font-bold">
            {cancelled ? t.invoiceVoid : t.invoiceTotal}
          </dt>
          <dd className="num tech tech-num border-t border-[var(--color-ink)] pt-1.5 text-[15px] font-bold">
            {withVat
              ? formatAmount(withVat.due.total, currency, locale)
              : formatMoneyExact(totalCents, currency, locale, rate)}
          </dd>
        </dl>
      </section>

      {/* Payment is by bank transfer only, so the paper copy carries the
          account too — a printed or forwarded PDF has no pay page behind it.
          Never on a void invoice: that is exactly the one not to pay. Plain
          text, no Copy buttons: this is the document, not the phone screen. */}
      {bank && !cancelled && (
        <section className="mt-8 text-[12px]">
          <h2 className="mb-1.5 text-[12px] font-bold">{t.invoicePayTo}</h2>
          {/* Both columns sized to their content: a stretched value column
              pushes a left-to-right account number to the far edge of a
              Persian page, away from its label. */}
          <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 gap-y-1">
            {bankRows(bank, t).map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-[var(--color-ink-muted)]">{row.label}</dt>
                <dd
                  className={row.number ? `tech ${locale === "fa" ? "text-right" : ""}` : undefined}
                  dir={row.number ? "ltr" : undefined}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {bank.note &&
            bank.note.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i} className="mt-1.5 whitespace-pre-line text-[var(--color-ink-muted)]">
                {paragraph}
              </p>
            ))}
        </section>
      )}

      {/* The step customers miss, so it is framed and coloured on screen and
          on paper alike. A printed invoice cannot be clicked: there the
          address is written out instead of the button. */}
      {proofUrl && !cancelled && (
        <section
          className="mt-5 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-[12px]"
          style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        >
          <h2 className="text-[13px] font-bold">{t.invoiceProofTitle}</h2>
          <p className="mt-1">{t.invoiceProofBody}</p>
          <a href={proofUrl} className="btn-primary no-print mt-2 inline-block">
            {t.invoiceProofButton}
          </a>
          <p className="print-only tech mt-1 break-all" dir="ltr">
            {proofUrl}
          </p>
        </section>
      )}

      <footer className="mt-8 border-t border-[var(--color-rule)] pt-3 text-[11px] text-[var(--color-ink-muted)]">
        <p>{t.invoiceThanks}</p>
      </footer>
    </>
  );
}

/** Filled fields only, in the order a transfer form asks for them. */
function bankRows(bank: BankDetails, t: ReturnType<typeof getDict>) {
  const rows: { label: string; value: string; number?: boolean }[] = [];
  if (bank.name) rows.push({ label: t.bankName, value: bank.name });
  if (bank.holder) rows.push({ label: t.bankHolder, value: bank.holder });
  if (bank.account) rows.push({ label: t.bankAccount, value: bank.account, number: true });
  if (bank.sheba) rows.push({ label: t.bankSheba, value: groupInFours(bank.sheba), number: true });
  if (bank.card) rows.push({ label: t.bankCard, value: groupInFours(bank.card), number: true });
  return rows;
}
