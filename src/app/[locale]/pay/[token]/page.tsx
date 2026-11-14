import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByPayToken } from "@/db/accountQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { getBankDetails } from "@/lib/bankSettings";
import { isPayToken } from "@/lib/payToken";
import { DEMO_MODE } from "@/lib/demo";
import { OrderView } from "@/components/OrderView";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { getDict, isLocale, type Locale } from "@/lib/i18n";
import { customerCurrencyFor } from "@/lib/money";
import { acceptsPaymentProof, customerCanCancel, type OrderStatus } from "@/lib/orders";
import { listPaymentProofs } from "@/db/paymentProofQueries";
import { PaymentProofSection } from "@/components/PaymentProofSection";
import { Deadline, deadlineNow } from "@/components/Deadline";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { runExpirySweep } from "@/lib/orderFlow";
import { fillMessage } from "@/lib/fillMessage";
import { acceptQuoteWithKeyAction, cancelOrderWithKeyAction, uploadPaymentProofWithKeyAction } from "./actions";
import { CancelOrderForm } from "@/components/CancelOrderForm";

/**
 * Kept out of search results, and the page sends no referrer: the URL is the
 * key, and any third-party request the page makes — the footer's trust seal is
 * one — would otherwise receive it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The private pay link. No sign-in: a customer opens it from a message on
 * their phone. It shows one order — the one whose token it carries — and what
 * to do next. Payment is by bank transfer, so once the order is invoiced this
 * page shows the account to pay into; before that there is nothing to pay and
 * no payment instructions are shown yet.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ placed?: string; ok?: string; error?: string }>;
}) {
  const { locale, token } = await params;
  const { placed, ok, error } = await searchParams;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  if (!isPayToken(token)) notFound();

  // Before the read, so a lapsed order shows as expired now rather than
  // after the next cron run.
  await runExpirySweep();
  const found = await getOrderByPayToken(token);
  if (!found) notFound();
  const { order, items } = found;

  // The demo takes no receipts (`receivePaymentProof`), so it offers no upload.
  const takesProof = acceptsPaymentProof(order.status) && !DEMO_MODE;
  const [liveRate, displayMode, bank, proofs] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
    takesProof ? getBankDetails(l) : Promise.resolve(null),
    listPaymentProofs([order.id]),
  ]);
  // A pro forma invoice has no number until payment is confirmed, so the
  // number cannot say whether there is a document.
  const invoiced = order.invoicedAt !== null;
  const viewInvoice =
    invoiced && order.status !== "cancelled" ? (
      <Link href={`/${l}/invoice/${order.ref}?key=${token}`} className="btn-small" prefetch={false}>
        {order.invoiceNumber === null ? t.viewPishFactor : t.viewInvoice}
      </Link>
    ) : null;
  const message: Record<OrderStatus, string> = {
    received: t.payBeingPriced,
    quoted: t.payQuoteReady,
    invoiced: t.payAmountDue,
    payment_review: t.payConfirming,
    preparing: t.payPaidThanks,
    shipped: t.payPaidThanks,
    delivered: t.payPaidThanks,
    cancelled: order.expiredAt !== null ? t.payExpired : t.payCancelled,
  };
  const placedMessage =
    placed === "1"
      ? order.status === "received"
        ? t.payPlacedQuote
        : order.status === "invoiced" || order.status === "payment_review"
          ? t.payPlacedPish
          : null
      : null;
  const now = deadlineNow();

  return (
    <main className="mx-auto max-w-[820px] px-3 pt-3 pb-16">
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{order.company}</h1>
        <span className="tech text-[13px]">{order.ref}</span>
        <OrderStatusPill locale={l} status={order.status} />
      </div>
      {placedMessage && <SuccessBanner>{placedMessage}</SuccessBanner>}
      {ok === "accepted" && <SuccessBanner>{t.quoteAccepted}</SuccessBanner>}
      {error === "accept" && <ErrorBanner>{t.acceptFailed}</ErrorBanner>}
      {ok === "cancelled" && <SuccessBanner>{t.orderCancelledOk}</SuccessBanner>}
      {error === "cancel" && <ErrorBanner>{t.cancelFailed}</ErrorBanner>}
      {error === "rate-limit" && <ErrorBanner>{t.rateLimited}</ErrorBanner>}
      <p className="mb-3 text-[13px]">{message[order.status]}</p>
      <Deadline locale={l} status={order.status} expiresAt={order.expiresAt} now={now} />
      {order.status === "quoted" && !DEMO_MODE && (
        <form action={acceptQuoteWithKeyAction.bind(null, token)} className="mb-4 grid gap-2">
          <input type="hidden" name="locale" value={l} />
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.acceptQuoteNote}</p>
          <button type="submit" className="btn-primary w-fit">
            {t.acceptQuote}
          </button>
        </form>
      )}
      {!DEMO_MODE && customerCanCancel(order.status, (proofs.get(order.id) ?? []).length) && (
        <CancelOrderForm locale={l} action={cancelOrderWithKeyAction.bind(null, token)} />
      )}
      {order.siblingPayToken && order.siblingRef && (
        <p className="mb-3 text-[12px]">
          <Link href={`/${l}/pay/${order.siblingPayToken}`}>
            {fillMessage(t.siblingOrder, { ref: order.siblingRef })}
          </Link>
        </p>
      )}
      <OrderView
        locale={l}
        order={order}
        items={items}
        currency={customerCurrencyFor(displayMode, l)}
        rate={order.fxRateToRial ?? liveRate}
        bank={bank}
        proof={
          <PaymentProofSection
            locale={l}
            proofs={proofs.get(order.id) ?? []}
            linked={false}
            upload={takesProof ? uploadPaymentProofWithKeyAction.bind(null, token) : undefined}
          />
        }
        estimate={order.status === "received"}
        actions={viewInvoice}
      />
    </main>
  );
}
