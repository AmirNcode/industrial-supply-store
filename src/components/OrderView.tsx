import type { ReactNode } from "react";
import { OrderTimeline } from "./OrderTimeline";
import { BankDetailsPanel } from "./BankDetailsPanel";
import type { AccountOrderItem } from "@/db/accountQueries";
import type { BankDetails } from "@/lib/bankDetails";
import type { OrderStatus } from "@/lib/orders";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt, formatPrice, type Currency } from "@/lib/money";

export type OrderViewOrder = {
  status: OrderStatus;
  createdAt: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  courier: string;
  trackingNumber: string;
  totalCents: number;
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
  /** Before invoicing these are today's catalog prices, not an offer. */
  estimate?: boolean;
}) {
  const t = getDict(locale);
  return (
    <>
      <OrderTimeline
        locale={locale}
        status={order.status}
        stamps={{
          createdAt: order.createdAt,
          invoicedAt: order.invoicedAt,
          paidAt: order.paidAt,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
        }}
      />

      {actions && <div className="mb-4 flex flex-wrap items-center gap-3">{actions}</div>}
      {bank && <BankDetailsPanel locale={locale} bank={bank} />}

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

      <div className="mt-3 flex justify-end text-[13px]">
        <span>
          {t.total}:{" "}
          <strong className="tech text-[15px]">
            {formatPrice(order.totalCents, currency, locale, rate)}
          </strong>
        </span>
      </div>
      {estimate && (
        <p className="mt-1 text-end text-[11px] text-[var(--color-ink-muted)]">{t.priceEstimate}</p>
      )}
    </>
  );
}
