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
import { acceptsPaymentProof, type OrderStatus } from "@/lib/orders";
import { listPaymentProofs } from "@/db/paymentProofQueries";
import { PaymentProofSection } from "@/components/PaymentProofSection";
import { uploadPaymentProofWithKeyAction } from "./actions";

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
export default async function PayPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  if (!isPayToken(token)) notFound();

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
  const invoiced = order.invoiceNumber !== null;
  const viewInvoice =
    invoiced && order.status !== "cancelled" ? (
      <Link href={`/${l}/invoice/${order.ref}?key=${token}`} className="btn-small" prefetch={false}>
        {t.viewInvoice}
      </Link>
    ) : null;
  const message: Record<OrderStatus, string> = {
    received: t.payBeingPriced,
    invoiced: t.payAmountDue,
    payment_review: t.payConfirming,
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
        proof={
          <PaymentProofSection
            locale={l}
            proofs={proofs.get(order.id) ?? []}
            linked={false}
            upload={takesProof ? uploadPaymentProofWithKeyAction.bind(null, token) : undefined}
          />
        }
        estimate={!invoiced}
        actions={viewInvoice}
      />
    </main>
  );
}
