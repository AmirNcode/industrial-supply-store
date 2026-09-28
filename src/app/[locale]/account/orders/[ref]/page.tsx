import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getOrderForUser } from "@/db/accountQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { OrderView } from "@/components/OrderView";
import { getBankDetails } from "@/lib/bankSettings";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { customerCurrencyFor } from "@/lib/money";

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

  const user = await currentUser();
  if (!user) redirect(`/${l}/account/signin`);
  if (user.mustChangePassword) redirect(`/${l}/account/password`);

  const found = await getOrderForUser(user.id, ref);
  // 404 rather than 403: a 403 would confirm the reference exists.
  if (!found) notFound();
  const { order, items } = found;

  const [liveRate, priceDisplayMode] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
  ]);
  const rate = order.fxRateToRial ?? liveRate;
  const currency = customerCurrencyFor(priceDisplayMode, l);
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

      <OrderView
        locale={l}
        order={order}
        items={items}
        currency={currency}
        rate={rate}
        bank={order.status === "invoiced" ? await getBankDetails(l) : null}
        estimate={!invoiced}
        actions={
          (order.paymentUrl || invoiced) && order.status !== "cancelled" ? (
            <>
              {/* New tab, matching the Pay control on the order list. */}
              {order.status === "invoiced" && order.paymentUrl && (
                <a
                  href={order.paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  {t.payNow}
                </a>
              )}
              {invoiced && (
                <Link href={`/${l}/invoice/${order.ref}`} className="btn-small" prefetch={false}>
                  {t.viewInvoice}
                </Link>
              )}
            </>
          ) : null
        }
      />
    </main>
  );
}
