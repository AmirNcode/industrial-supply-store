import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { getOrderForRep } from "@/db/repOrderQueries";
import { reorderAction, uploadPaymentProofForRepAction } from "../../../actions";
import { acceptsPaymentProof } from "@/lib/orders";
import { hasUnpricedLine } from "@/lib/invoice";
import { listPaymentProofs } from "@/db/paymentProofQueries";
import { PaymentProofSection } from "@/components/PaymentProofSection";
import { getFxRate } from "@/lib/fx";
import { siteOrigin } from "@/lib/siteOrigin";
import { commissionPercentLabel } from "@/lib/repAccount";
import { OrderView } from "@/components/OrderView";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { ShareButton } from "@/components/ShareButton";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { fillMessage } from "@/lib/fillMessage";

const ERROR_KEY = {
  "not-yours": "reorderNotYours",
  "cart-full": "reorderCartFull",
  conflict: "orderConflict",
  unpriced: "repInvoiceUnpriced",
  "no-rate": "invoiceNeedsRate",
  "no-contact": "invoiceNeedsContact",
  "too-large": "orderTooLarge",
} as const;

/**
 * One order as its rep sees it: its invoice — to create, or to open — the pay
 * link to send, the commission locked onto it, and the order itself exactly as
 * the customer sees it, in rial.
 */
export default async function RepOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error } = await searchParams;
  const rep = await requireRep(l);

  // 404 for an order this rep may not see, as for someone else's customer.
  const found = await getOrderForRep(rep.id, ref);
  if (!found) notFound();
  const { order, items } = found;
  const [liveRate, origin, proofs] = await Promise.all([
    getFxRate(),
    siteOrigin(),
    listPaymentProofs([order.id]),
  ]);
  const orderProofs = proofs.get(order.id) ?? [];
  // Null on an order credited to another rep: this one sees it, read-only.
  const payUrl = order.payToken ? `${origin}/${l}/pay/${order.payToken}` : null;
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;
  const rateBp = order.commissionRateBp ?? 0;

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/rep/orders`}>← {t.ordersTab}</Link>
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="tech text-[17px] font-bold" dir="ltr">
          {order.ref}
        </h1>
        <OrderStatusPill locale={l} status={order.status} />
        {order.customerIsMine && order.customerId ? (
          <Link href={`/${l}/rep/customers/${order.customerId}`} className="text-[13px]">
            {order.company}
          </Link>
        ) : (
          <span className="text-[13px]">{order.company}</span>
        )}
        {order.customerCode && (
          <span className="tech text-[12px] text-[var(--color-ink-muted)]" dir="ltr">
            {order.customerCode}
          </span>
        )}
      </div>

      {ok === "created" && <SuccessBanner>{t.repOrderCreated}</SuccessBanner>}
      {ok === "invoiced" && <SuccessBanner>{t.invoiceIssued}</SuccessBanner>}
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}
      {order.creditedToMe && (
          <p className="mb-3 text-[12px]" data-testid="commission-line">
            {rateBp > 0
              ? t.commissionLocked.replace("{percent}", commissionPercentLabel(rateBp, l))
              : t.commissionNone}
          </p>
      )}

      {!order.creditedToMe && (
        <p className="mb-3 text-[12px] text-[var(--color-ink-muted)]" data-testid="rep-order-read-only">
          {t.repOrderReadOnly}
        </p>
      )}

      {order.creditedToMe && order.status === "received" && (
        <section className="mb-4 flex flex-wrap items-center gap-3 border border-[var(--color-rule)] p-3 text-[12px]">
          {/* A rep never changes a price, so a line at 0 is the admin's to price. */}
          {hasUnpricedLine(items) ? (
            <span data-testid="rep-invoice-unpriced">{t.repInvoiceUnpriced}</span>
          ) : (
            <>
              <Link href={`/${l}/rep/orders/${order.ref}/invoice`} className="btn-primary" prefetch={false}>
                {t.createInvoice}
              </Link>
              <span className="text-[var(--color-ink-muted)]">{t.repInvoiceHint}</span>
            </>
          )}
        </section>
      )}

      {order.creditedToMe && (
        <PaymentProofSection
          locale={l}
          proofs={orderProofs}
          showUploader
          hint={t.proofHintRep}
          upload={
            acceptsPaymentProof(order.status)
              ? uploadPaymentProofForRepAction.bind(null, order.ref)
              : undefined
          }
        >
          {/* Confirming the money arrived is the admin's alone. */}
          {order.status === "payment_review" && (
            <p className="border-t border-[var(--color-rule)] pt-3 text-[12px] text-[var(--color-ink-muted)]">
              {t.repAwaitingConfirmation}
            </p>
          )}
        </PaymentProofSection>
      )}

      {payUrl && (
        <section className="mb-4 border border-[var(--color-rule)] p-3 text-[12px]">
          <h2 className="mb-1.5 text-[13px] font-bold">{t.payLink}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <code data-testid="pay-link" dir="ltr" className="tech break-all">
              {payUrl}
            </code>
            <ShareButton
              text={fillMessage(t.payLinkMessage, { company: order.company, ref: order.ref, url: payUrl })}
              label={t.sharePayLink}
              copiedLabel={t.copied}
            />
            <Link href={`/${l}/pay/${order.payToken}`} target="_blank" prefetch={false}>
              {t.openPayPage}
            </Link>
            {/* The pay link's key opens the invoice, as it does for the customer. */}
            {order.invoiceNumber && order.status !== "cancelled" && (
              <Link href={`/${l}/invoice/${order.ref}?key=${order.payToken}`} prefetch={false}>
                {t.viewInvoice}
              </Link>
            )}
          </div>
        </section>
      )}

      <OrderView
        locale={l}
        order={order}
        items={items}
        currency="IRR"
        rate={order.fxRateToRial ?? liveRate}
        estimate={order.invoiceNumber === null}
        actions={
          order.customerIsMine ? (
            <form action={reorderAction}>
              <input type="hidden" name="locale" value={l} />
              <input type="hidden" name="ref" value={order.ref} />
              <button type="submit" className="btn-small">
                {t.reorder}
              </button>
            </form>
          ) : null
        }
      />
    </>
  );
}
