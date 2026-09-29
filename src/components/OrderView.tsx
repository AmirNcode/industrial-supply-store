import type { ReactNode } from "react";
import { OrderTimeline } from "./OrderTimeline";
import { BankDetailsPanel } from "./BankDetailsPanel";
import type { AccountOrderItem } from "@/db/accountQueries";
import type { BankDetails } from "@/lib/bankDetails";
import type { OrderStatus } from "@/lib/orders";
import { getDict, type Locale } from "@/lib/i18n";
import { invoiceAmounts, roundedForDisplay } from "@/lib/invoice";
import { formatVatPercent } from "@/lib/vat";
import { formatAmount, formatInt, formatPrice, type Currency } from "@/lib/money";

export type OrderViewOrder = {
  status: OrderStatus;
  createdAt: string;
  invoicedAt: string | null;
  paymentSubmittedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  courier: string;
  trackingNumber: string;
  totalCents: number;
  /** Locked at invoicing; null before, and on invoices issued before VAT. */
  vatRateBp: number | null;
};

/**
 * One order as its buyer sees it: timeline, what to do next, how to pay,
 * tracking, lines and total. Shared by the customer's order page, the private
 * pay page and the rep's order page, which differ only in the actions they
 * offer — so a fix to the table lands on all three.
 */
export function OrderView({
  locale,
  order,
  items,
  currency,
  rate,
  actions,
  bank,
  proof,
  estimate = false,
}: {
  locale: Locale;
  order: OrderViewOrder;
  items: AccountOrderItem[];
  currency: Currency;
  rate: number;
  /** Null or absent when there is nothing to offer, so no empty row is drawn. */
  actions?: ReactNode;
  bank?: BankDetails | null;
  /** Proof of payment: the upload and the receipts, after the bank account. */
  proof?: ReactNode;
  /** Before invoicing these are today's catalog prices, not an offer. */
  estimate?: boolean;
}) {
  const t = getDict(locale);
  // Rounded like every other figure on this page; the invoice has the exact
  // amounts, and these still add up to the total shown.
  const vat =
    order.vatRateBp === null
      ? null
      : roundedForDisplay(invoiceAmounts(order.totalCents, order.vatRateBp, currency, rate), currency);
  return (
    <>
      <OrderTimeline
        locale={locale}
        status={order.status}
        stamps={{
          createdAt: order.createdAt,
          invoicedAt: order.invoicedAt,
          paymentSubmittedAt: order.paymentSubmittedAt,
          paidAt: order.paidAt,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
        }}
      />

      {actions && <div className="mb-4 flex flex-wrap items-center gap-3">{actions}</div>}
      {bank && <BankDetailsPanel locale={locale} bank={bank} />}
      {proof}

      {order.status === "shipped" && order.trackingNumber && (
        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 border border-[var(--color-rule)] p-3 text-[12px]">
          <div className="flex gap-1.5">
            <dt className="font-bold">{t.courier}:</dt>
            <dd>{order.courier}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-bold">{t.trackingNumber}:</dt>
            <dd className="tech">{order.trackingNumber}</dd>
          </div>
        </dl>
      )}

      <table className="spec-table">
        <thead>
          <tr>
            <th>{t.partNumber}</th>
            <th>{t.invoiceDescription}</th>
            <th className="num">{t.qty}</th>
            <th className="num">{t.unitPrice}</th>
            <th className="num">{t.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="tech font-bold">{i.partNumber}</td>
              <td className="whitespace-normal">{i.familyName}</td>
              <td className="num tech tech-num">{formatInt(i.qty, locale)}</td>
              <td className="num tech tech-num">
                {formatPrice(i.unitPriceCents, currency, locale, rate)}
              </td>
              <td className="num tech tech-num">
                {formatPrice(i.unitPriceCents * i.qty, currency, locale, rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {vat && order.vatRateBp !== null ? (
        <dl className="mt-3 ms-auto grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-[13px]">
          <dt>{t.invoiceSubtotal}:</dt>
          <dd className="num tech">{formatAmount(vat.subtotal, currency, locale)}</dd>
          <dt>{t.invoiceVat.replace("{percent}", formatVatPercent(order.vatRateBp, locale))}:</dt>
          <dd className="num tech">{formatAmount(vat.vat, currency, locale)}</dd>
          <dt>{t.total}:</dt>
          <dd className="num">
            <strong className="tech text-[15px]">{formatAmount(vat.total, currency, locale)}</strong>
          </dd>
        </dl>
      ) : (
        <div className="mt-3 flex justify-end text-[13px]">
          <span>
            {t.total}:{" "}
            <strong className="tech text-[15px]">
              {formatPrice(order.totalCents, currency, locale, rate)}
            </strong>
          </span>
        </div>
      )}
      {estimate && (
        <p className="mt-1 text-end text-[11px] text-[var(--color-ink-muted)]">{t.priceEstimate}</p>
      )}
    </>
  );
}
