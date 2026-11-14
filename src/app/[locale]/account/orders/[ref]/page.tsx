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
import { acceptsPaymentProof, customerCanCancel } from "@/lib/orders";
import { CancelOrderForm } from "@/components/CancelOrderForm";
import { listPaymentProofs } from "@/db/paymentProofQueries";
import { PaymentProofSection } from "@/components/PaymentProofSection";
import { Deadline, deadlineNow } from "@/components/Deadline";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { runExpirySweep } from "@/lib/orderFlow";
import { fillMessage } from "@/lib/fillMessage";
import { acceptQuoteAction, cancelOrderAction, reorderAction, uploadPaymentProofAction } from "../../actions";

/**
 * One order, as its customer sees it.
 *
 * A customer can do three things here: accept a quote, upload a payment
 * receipt (which moves `invoiced` to `payment_review`), and cancel the order
 * until a receipt exists (`customerCanCancel`). Every other transition —
 * pricing, confirming payment, shipping, cancelling once money may have
 * moved — belongs to staff.
 */
export default async function AccountOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, ref } = await params;
  const { ok, error } = await searchParams;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const user = await currentUser();
  if (!user) redirect(`/${l}/account/signin`);
  // Before anything else: an account made at checkout has no password yet.
  if (user.needsPassword) redirect(`/${l}/account/password/new`);
  if (user.mustChangePassword) redirect(`/${l}/account/password`);

  // Before the order read, so a lapsed order shows as expired now.
  await runExpirySweep();
  const found = await getOrderForUser(user.id, ref);
  // 404 rather than 403: a 403 would confirm the reference exists.
  if (!found) notFound();
  const { order, items } = found;

  const takesProof = acceptsPaymentProof(order.status);
  const [liveRate, priceDisplayMode, proofs, bank] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
    listPaymentProofs([order.id]),
    // While payment is owed or being checked: a second transfer, or the
    // customer re-reading the account after uploading, is normal.
    takesProof ? getBankDetails(l) : Promise.resolve(null),
  ]);
  const rate = order.fxRateToRial ?? liveRate;
  const currency = customerCurrencyFor(priceDisplayMode, l);
  // A pro forma invoice has no number, so the number cannot say a document exists.
  const invoiced = order.invoicedAt !== null;
  const now = deadlineNow();

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

      {ok === "accepted" && <SuccessBanner>{t.quoteAccepted}</SuccessBanner>}
      {error === "accept" && <ErrorBanner>{t.acceptFailed}</ErrorBanner>}
      {ok === "cancelled" && <SuccessBanner>{t.orderCancelledOk}</SuccessBanner>}
      {error === "cancel" && <ErrorBanner>{t.cancelFailed}</ErrorBanner>}
      {error === "cart-full" && <ErrorBanner>{t.reorderCartFull}</ErrorBanner>}
      {error === "rate-limit" && <ErrorBanner>{t.rateLimited}</ErrorBanner>}
      {order.status === "cancelled" && order.expiredAt !== null && (
        <p className="mb-3 text-[13px]">{t.payExpired}</p>
      )}
      <Deadline locale={l} status={order.status} expiresAt={order.expiresAt} now={now} />
      {order.status === "quoted" && (
        <form action={acceptQuoteAction} className="mb-4 grid gap-2">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="ref" value={order.ref} />
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.acceptQuoteNote}</p>
          <button type="submit" className="btn-primary w-fit">
            {t.acceptQuote}
          </button>
        </form>
      )}
      {customerCanCancel(order.status, (proofs.get(order.id) ?? []).length) && (
        <CancelOrderForm locale={l} action={cancelOrderAction} hidden={{ ref: order.ref }} />
      )}
      {order.siblingRef && (
        <p className="mb-3 text-[12px]">
          <Link href={`/${l}/account/orders/${order.siblingRef}`}>
            {fillMessage(t.siblingOrder, { ref: order.siblingRef })}
          </Link>
        </p>
      )}

      <OrderView
        locale={l}
        order={order}
        items={items}
        currency={currency}
        rate={rate}
        bank={bank}
        proof={
          <PaymentProofSection
            locale={l}
            proofs={proofs.get(order.id) ?? []}
            upload={takesProof ? uploadPaymentProofAction.bind(null, order.ref) : undefined}
          />
        }
        estimate={order.status === "received"}
        actions={
          <>
            {invoiced && order.status !== "cancelled" && (
              <Link href={`/${l}/invoice/${order.ref}`} className="btn-small" prefetch={false}>
                {order.invoiceNumber === null ? t.viewPishFactor : t.viewInvoice}
              </Link>
            )}
            <form action={reorderAction}>
              <input type="hidden" name="locale" value={l} />
              <input type="hidden" name="ref" value={order.ref} />
              <button type="submit" className="btn-small">
                {t.reorder}
              </button>
            </form>
          </>
        }
      />
    </main>
  );
}
