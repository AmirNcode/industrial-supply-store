import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { getOrderForUser } from "@/db/accountQueries";
import { getFxRate } from "@/lib/fx";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { OrderTimeline } from "@/components/OrderTimeline";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";

/**
 * One order, read-only.
 *
 * There is deliberately nothing here that changes anything. Every transition
 * belongs to staff — that single-actor rule is what keeps this whole feature
 * small, and an Approve or Cancel button here would quietly undo it.
 */
export default async function AccountOrderPage({
  params,
}: {
  params: Promise<{ locale: string; ref: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const userId = await currentUserId();
  if (!userId) redirect(`/${l}/account/signin`);

  const found = await getOrderForUser(userId, ref);
  // 404 rather than 403: a 403 would confirm the reference exists.
  if (!found) notFound();
  const { order, items } = found;

  const rate = order.fxRateToToman ?? (await getFxRate());
  const invoiced = order.invoiceNumber !== null;

  return (
    <main className="mx-auto max-w-[820px] px-3 pt-3">
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/account`}>← {t.myOrders}</Link>
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="tech text-[17px] font-bold">{order.ref}</h1>
        <OrderStatusPill locale={l} status={order.status} />
        {order.poNumber && (
          <span className="text-[11px] text-[var(--color-ink-muted)]">
            {t.poNumber}: <span className="tech">{order.poNumber}</span>
          </span>
        )}
      </div>

      <OrderTimeline
        locale={l}
        status={order.status}
        stamps={{
          createdAt: order.createdAt,
          invoicedAt: order.invoicedAt,
          paidAt: order.paidAt,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
        }}
      />

      {(order.paymentUrl || invoiced) && order.status !== "cancelled" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {order.status === "invoiced" && order.paymentUrl && (
            <a href={order.paymentUrl} className="btn-primary" rel="noopener noreferrer">
              {t.payNow}
            </a>
          )}
          {invoiced && (
            <Link href={`/${l}/invoice/${order.ref}`} className="btn-small" prefetch={false}>
              {t.viewInvoice}
            </Link>
          )}
        </div>
      )}

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
              <td className="num tech tech-num">{formatInt(i.qty, l)}</td>
              <td className="num tech tech-num">{formatPrice(i.unitPriceCents, l, rate)}</td>
              <td className="num tech tech-num">
                {formatPrice(i.unitPriceCents * i.qty, l, rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end text-[13px]">
        <span>
          {t.total}:{" "}
          <strong className="tech text-[15px]">
            {formatPrice(order.totalCents, l, rate)}
          </strong>
        </span>
      </div>
    </main>
  );
}
