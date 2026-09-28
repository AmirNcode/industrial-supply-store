import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { formatPrice } from "@/lib/money";
import { formatPersianDate } from "@/lib/persianCalendar";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import type { AccountOrderRow } from "@/db/accountQueries";

/**
 * A customer's orders as the rep and the admin see them on the customer page:
 * always in rial, because reps never see dollar amounts. An order's own frozen
 * rate wins over today's, so an invoiced total does not drift.
 */
export function CustomerOrderList({
  locale,
  orders,
  liveRate,
  orderHref,
}: {
  locale: Locale;
  orders: AccountOrderRow[];
  liveRate: number;
  /** Where a reference links to, when the viewer has a page for one order. */
  orderHref?: (ref: string) => string;
}) {
  const t = getDict(locale);
  return (
    <section className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 text-[13px] font-bold">{t.customerOrders}</h2>
      {orders.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noOrdersYet}</p>
      ) : (
        <ul className="grid gap-1 text-[12px]">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-baseline gap-3">
              {orderHref ? (
                <Link href={orderHref(order.ref)} className="tech" dir="ltr">
                  {order.ref}
                </Link>
              ) : (
                <span className="tech" dir="ltr">
                  {order.ref}
                </span>
              )}
              <OrderStatusPill locale={locale} status={order.status} />
              <span className="text-[var(--color-ink-muted)]">
                {formatPersianDate(order.createdAt, locale)}
              </span>
              <span className="num">
                {formatPrice(order.totalCents, "IRR", locale, order.fxRateToRial ?? liveRate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
