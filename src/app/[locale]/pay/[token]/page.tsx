import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByPayToken } from "@/db/accountQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { getBankDetails } from "@/lib/bankSettings";
import { isPayToken } from "@/lib/payToken";
import { OrderView } from "@/components/OrderView";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { getDict, isLocale, type Locale } from "@/lib/i18n";
import { customerCurrencyFor } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders";

/**
 * Kept out of search results, and the page sends no referrer: the Pay button
 * leaves for a bank's page, which would otherwise receive this URL — and the
 * URL is the key.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The private pay link. No sign-in: a customer opens it from a message on
 * their phone. It shows one order — the one whose token it carries — and what
 * to do next. Before the admin prices the order there is nothing to pay, so
 * no payment instructions are shown yet.
 */
export default async function PayPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  if (!isPayToken(token)) notFound();

  const found = await getOrderByPayToken(token);
  if (!found) notFound();
  const { order, items } = found;

  const [liveRate, displayMode, bank] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
    order.status === "invoiced" ? getBankDetails(l) : Promise.resolve(null),
  ]);
  const invoiced = order.invoiceNumber !== null;
  const payNow =
    order.status === "invoiced" && order.paymentUrl ? (
      <a href={order.paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
        {t.payNow}
      </a>
    ) : null;
  const viewInvoice =
    invoiced && order.status !== "cancelled" ? (
      <Link href={`/${l}/invoice/${order.ref}?key=${token}`} className="btn-small" prefetch={false}>
        {t.viewInvoice}
      </Link>
    ) : null;
  const message: Record<OrderStatus, string> = {
    received: t.payBeingPriced,
    invoiced: t.payAmountDue,
    preparing: t.payPaidThanks,
    shipped: t.payPaidThanks,
    delivered: t.payPaidThanks,
    cancelled: t.payCancelled,
  };

  return (
    <main className="mx-auto max-w-[820px] px-3 pt-3 pb-16">
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{order.company}</h1>
        <span className="tech text-[13px]">{order.ref}</span>
        <OrderStatusPill locale={l} status={order.status} />
      </div>
      <p className="mb-3 text-[13px]">{message[order.status]}</p>
      <OrderView
        locale={l}
        order={order}
        items={items}
        currency={customerCurrencyFor(displayMode, l)}
        rate={order.fxRateToRial ?? liveRate}
        bank={bank}
        estimate={!invoiced}
        actions={
          payNow || viewInvoice ? (
            <>
              {payNow}
              {viewInvoice}
            </>
          ) : null
        }
      />
    </main>
  );
}
