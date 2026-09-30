import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import Link from "next/link";
import { sql } from "@/db";
import { DEMO_MODE } from "@/lib/demo";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { customerCurrencyFor, formatPrice, formatInt } from "@/lib/money";
import { formatOrderTotal } from "@/lib/invoice";
import { draftLinePrices, priceParamName, priceParamValue } from "@/lib/invoiceDraft";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { OrderStatusPill, STATUS_LABEL_KEY } from "@/components/OrderStatusPill";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PayLinkReveal } from "@/components/PayLinkReveal";
import { commissionPercentLabel } from "@/lib/repAccount";
import { listCommentsForOrders, type OrderComment } from "@/db/commentQueries";
import { findShortfalls } from "@/db/inventoryQueries";
import { listPaymentProofs } from "@/db/paymentProofQueries";
import { PaymentProofSection } from "@/components/PaymentProofSection";
import {
  setOrderStatusAction,
  addCommentAction,
  payLinkForOrderAction,
  replacePayLinkAction,
} from "../../actions";
import type { SpecBag } from "@/db/schema";
import { ORDER_STATUSES, isOrderStatus, nextStatuses, type OrderStatus } from "@/lib/orders";

type OrderRow = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  city: string;
  country: string;
  notes: string;
  status: OrderStatus;
  locale: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  itemCount: number;
  courier: string;
  trackingNumber: string;
  invoiceNumber: string | null;
  fxRateToRial: number | null;
  vatRateBp: number | null;
  /** Locked onto the order when it was placed; null when no rep is credited. */
  repName: string | null;
  placedByRep: boolean;
  commissionRateBp: number | null;
  customerCode: string | null;
  /** The account that placed the order; null for a guest order. */
  userId: string | null;
};

type OrderItemRow = {
  id: number;
  orderId: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
  requestedUnitPriceCents: number;
  specsSnapshot: SpecBag;
};

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `edit` reopens one order with the prices a draft carried back as `price_<id>`. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  await requireAdmin(l);
  const t = getDict(l);
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const editRef = typeof sp.edit === "string" ? sp.edit : null;
  const statusFilter = typeof sp.status === "string" && isOrderStatus(sp.status)
    ? sp.status
    : null;

  // `requireAdmin` above is the sign-in gate; the panel layout's check does not
  // stop this page from rendering (see `lib/admin.ts`). FX and the queue have
  // no dependency, so do not spend one database round trip waiting to start
  // the other.
  const [rate, priceDisplayMode, orders] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
    sql<OrderRow[]>`
      SELECT q.id, q.ref, q.company, q.contact_name AS "contactName", q.email,
             q.phone, q.po_number AS "poNumber", q.city, q.country, q.notes,
             q.status, q.locale, q.currency, q.total_cents AS "totalCents",
             q.created_at AS "createdAt", q.courier,
             q.tracking_number AS "trackingNumber",
             q.invoice_number AS "invoiceNumber",
             q.fx_rate_to_rial AS "fxRateToRial", q.vat_rate_bp AS "vatRateBp",
             (SELECT count(*)::int FROM order_items i WHERE i.order_id = q.id) AS "itemCount",
             r.name AS "repName", q.placed_by_rep AS "placedByRep",
             q.commission_rate_bp AS "commissionRateBp",
             u.customer_code AS "customerCode", q.user_id AS "userId"
      FROM orders q
      LEFT JOIN sales_reps r ON r.id = q.rep_id
      LEFT JOIN users u ON u.id = q.user_id
      ${statusFilter ? sql`WHERE q.status = ${statusFilter}` : sql`WHERE q.status <> 'delivered' AND q.status <> 'cancelled'`}
      ORDER BY q.created_at DESC LIMIT 200
    `,
  ]);

  const orderIds = orders.map((order) => order.id);
  const [items, commentsByOrder, shortfalls, proofsByOrder] = await Promise.all([
    orders.length
      ? sql<OrderItemRow[]>`
        SELECT id, order_id AS "orderId", part_number AS "partNumber",
               family_name AS "familyName", qty,
               unit_price_cents AS "unitPriceCents",
               requested_unit_price_cents AS "requestedUnitPriceCents",
               specs_snapshot AS "specsSnapshot"
        FROM order_items WHERE order_id = ANY(${orderIds})
        ORDER BY id
      `
      : Promise.resolve([] as OrderItemRow[]),
    listCommentsForOrders(orderIds),
    // Advisory, not blocking: the order already exists. This is so staff see
    // the shortfall before they price it on the phone, not after.
    findShortfalls(orderIds),
    listPaymentProofs(orderIds),
  ]);

  const byOrder = new Map<number, OrderItemRow[]>();
  for (const i of items) {
    if (!byOrder.has(i.orderId)) byOrder.set(i.orderId, []);
    byOrder.get(i.orderId)!.push(i);
  }

  const editOrder = editRef ? orders.find((order) => order.ref === editRef) : undefined;
  const editPrices = editOrder ? draftLinePrices(sp, byOrder.get(editOrder.id) ?? []) : null;

  const formatOrderPrice = (cents: number, order: OrderRow) => {
    const orderLocale: Locale = order.locale === "fa" ? "fa" : "en";
    return formatPrice(
      cents,
      customerCurrencyFor(priceDisplayMode, orderLocale),
      orderLocale,
      order.fxRateToRial ?? rate,
    );
  };

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.quoteRequests}{" "}
        <span className="text-[12px] font-normal text-[var(--color-ink-muted)] tech">
          {formatInt(orders.length, l)}
        </span>
      </h1>

      <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link
          href={`/${l}/admin/orders`}
          className={statusFilter === null ? "font-bold !text-[var(--color-ink)]" : undefined}
        >
          {t.needsAction}
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${l}/admin/orders?status=${s}`}
            className={statusFilter === s ? "font-bold !text-[var(--color-ink)]" : undefined}
          >
            {t[STATUS_LABEL_KEY[s]]}
          </Link>
        ))}
      </nav>

      {ok === "status" && <SuccessBanner>{t.orderUpdated}</SuccessBanner>}
      {ok === "comment" && <SuccessBanner>{t.noteAdded}</SuccessBanner>}
      {ok === "invoiced" && <SuccessBanner>{t.invoiceIssued}</SuccessBanner>}
      {ok === "paylink" && <SuccessBanner>{t.payLinkReplaced}</SuccessBanner>}
      {error === "prices" && <ErrorBanner>{t.pricesRequired}</ErrorBanner>}
      {error === "tracking" && <ErrorBanner>{t.trackingRequired}</ErrorBanner>}
      {error === "not-found" && <ErrorBanner>{t.orderNotFound}</ErrorBanner>}
      {error === "conflict" && <ErrorBanner>{t.orderConflict}</ErrorBanner>}
      {error === "no-rate" && <ErrorBanner>{t.invoiceNeedsRate}</ErrorBanner>}
      {error === "too-large" && <ErrorBanner>{t.orderTooLarge}</ErrorBanner>}
      {error === "bad-request" && <ErrorBanner>{t.badRequest}</ErrorBanner>}

      {orders.length === 0 && (
        <p className="py-8 text-[13px] text-[var(--color-ink-muted)]">{t.noQuotes}</p>
      )}

      {orders.map((q) => (
        <details
          key={q.id}
          className="mb-2 border border-[var(--color-rule)]"
          // Back from a draft's "Change prices": this order, open, prices kept.
          open={q.ref === editRef || undefined}
        >
          <summary className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-[var(--color-panel-alt)] px-3 py-2 text-[12px] cursor-pointer">
            <strong className="tech">{q.ref}</strong>
            <OrderStatusPill locale={l} status={q.status} />
            <span>{q.company}</span>
            {q.customerCode && (
              <span className="tech text-[var(--color-ink-muted)]" dir="ltr">
                {q.customerCode}
              </span>
            )}
            {q.repName && (
              <span className="border border-[var(--color-rule)] px-1.5 text-[11px]">
                {t.repLabel}: {q.repName}
                {q.placedByRep && ` · ${t.placedByRep}`}
              </span>
            )}
            <span className="text-[var(--color-ink-muted)]">{q.contactName}</span>
            <span className="tech text-[var(--color-ink-muted)]">{q.email}</span>
            <span className="ms-auto tech text-[var(--color-ink-faint)]">
              {new Date(q.createdAt).toISOString().slice(0, 16).replace("T", " ")}
            </span>
            {/* An invoiced order renders at the rate it was invoiced at, not
                the live rate on this page load: the alternative is the amount
                a customer owes changing every time someone edits the
                exchange rate after their invoice has already gone out. The
                live rate is only correct for an order that has not been
                priced yet, which is exactly when fxRateToRial is still
                null. The same goes for its VAT rate. */}
            <span className="tech font-bold">
              {formatOrderTotal(
                q.totalCents,
                q.vatRateBp,
                customerCurrencyFor(priceDisplayMode, q.locale === "fa" ? "fa" : "en"),
                q.locale === "fa" ? "fa" : "en",
                q.fxRateToRial ?? rate,
              )}
            </span>
          </summary>

          <div className="px-3 py-2">
            <dl className="mb-2 grid gap-x-6 gap-y-0.5 text-[11px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              {q.phone && <Row label={t.phone} value={q.phone} tech />}
              {q.repName && (
                <Row
                  label={t.repLabel}
                  value={`${q.repName} · ${
                    q.commissionRateBp && q.commissionRateBp > 0
                      ? commissionPercentLabel(q.commissionRateBp, l)
                      : t.commissionNone
                  }`}
                />
              )}
              <div className="flex items-baseline gap-1.5">
                <dt className="font-bold">{t.payLink}:</dt>
                <dd className="flex flex-wrap items-baseline gap-x-3">
                  {/* Fetched on request, never rendered into the page: the
                      link is the order's key (`PayLinkReveal`). */}
                  <PayLinkReveal
                    load={payLinkForOrderAction.bind(null, q.id)}
                    showLabel={t.showPayLink}
                    copyLabel={t.copy}
                    copiedLabel={t.copied}
                    disabled={DEMO_MODE}
                  />
                  <form action={replacePayLinkAction} className="inline">
                    <input type="hidden" name="locale" value={l} />
                    <input type="hidden" name="orderId" value={q.id} />
                    <input type="hidden" name="statusFilter" value={statusFilter ?? ""} />
                    <ConfirmSubmit
                      label={t.replacePayLink}
                      title={t.confirmReplacePayLink}
                      continueLabel={t.confirmContinue}
                      discardLabel={t.confirmDiscard}
                      disabled={DEMO_MODE}
                      className="underline disabled:no-underline disabled:opacity-50"
                      details={[{ label: t.confirmOrder, value: q.ref, tech: true }]}
                    />
                  </form>
                </dd>
              </div>
              {q.poNumber && <Row label={t.poNumber} value={q.poNumber} tech />}
              {/* The account that placed the order, never one matched by the
                  email typed on it: anyone can type anyone's address on a
                  guest order, and a reset from here once handed that person
                  the victim's account (review finding H-11). Resets happen on
                  the customer's own page. */}
              {q.userId && (
                <div className="flex items-baseline gap-1.5">
                  <dt className="font-bold">{t.account}:</dt>
                  <dd>
                    <Link href={`/${l}/admin/customers/${q.userId}`} prefetch={false} className="underline">
                      {q.customerCode ?? t.account}
                    </Link>
                  </dd>
                </div>
              )}
              {q.city && <Row label={t.city} value={q.city} />}
              {q.country && <Row label={t.country} value={q.country} />}
              <Row label={t.status} value={q.status} />
              {q.courier && <Row label={t.courier} value={q.courier} />}
              {q.trackingNumber && <Row label={t.trackingNumber} value={q.trackingNumber} tech />}
              {q.invoiceNumber && (
                <div className="flex gap-1.5">
                  <dt className="font-bold">{t.invoiceNumber}:</dt>
                  <dd>
                    <Link href={`/${l}/invoice/${q.ref}`} className="tech" prefetch={false}>
                      {q.invoiceNumber}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            {(shortfalls.get(q.id) ?? []).length > 0 && (
              <p className="mb-2 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-[11px]">
                <strong>{t.stockShortfall}</strong>{" "}
                {(shortfalls.get(q.id) ?? []).map((s, i) => (
                  <span key={s.partNumber}>
                    {i > 0 && ", "}
                    <span className="tech font-semibold">{s.partNumber}</span>{" "}
                    <span className="tech">
                      {formatInt(s.qty, l)}/{formatInt(s.available, l)}
                    </span>
                  </span>
                ))}
              </p>
            )}
            {q.notes && (
              <p className="mb-2 whitespace-pre-wrap border-s-2 border-[var(--color-rule)] ps-2 text-[11px] text-[var(--color-ink-muted)]">
                {q.notes}
              </p>
            )}
            {/* Receipts, before the buttons that act on them. */}
            {(q.status === "payment_review" || (proofsByOrder.get(q.id) ?? []).length > 0) && (
              <PaymentProofSection locale={l} proofs={proofsByOrder.get(q.id) ?? []} showUploader />
            )}
            {/* 'invoiced' and 'payment_review' are legal next statuses, but no
                button renders for either: an invoice is issued from its draft
                page, reached by "Create invoice" below, and review begins when
                a receipt is uploaded. */}
            {nextStatuses(q.status).filter((s) => s !== "invoiced" && s !== "payment_review").length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {nextStatuses(q.status).filter((s) => s !== "invoiced" && s !== "payment_review").map((next) => (
                  <form key={next} action={setOrderStatusAction} className="inline-flex items-center gap-1.5">
                    <input type="hidden" name="locale" value={l} />
                    <input type="hidden" name="orderId" value={q.id} />
                    <input type="hidden" name="status" value={next} />
                    {/* Named separately from "status" above, which already
                        carries the transition's target status — the queue
                        filter being carried back to after the redirect is a
                        different value entirely. */}
                    <input type="hidden" name="statusFilter" value={statusFilter ?? ""} />
                    {next === "shipped" && (
                      <>
                        <input
                          type="text"
                          name="courier"
                          placeholder={t.courier}
                          className="w-28 text-[11px]"
                          required
                        />
                        <input
                          type="text"
                          name="trackingNumber"
                          dir="ltr"
                          placeholder={t.trackingNumber}
                          className="tech w-36 text-[11px]"
                          required
                        />
                      </>
                    )}
                    <ConfirmSubmit
                      label={
                        next === "preparing"
                          ? q.status === "payment_review" ? t.confirmPayment : t.markPaid
                          : next === "shipped" ? t.markShipped
                          : next === "delivered" ? t.markDelivered
                          : next === "cancelled" ? t.cancelOrder
                          : next
                      }
                      title={
                        next === "preparing"
                          ? q.status === "payment_review" ? t.confirmConfirmPayment : t.confirmMarkPaid
                          : next === "shipped" ? t.confirmMarkShipped
                          : next === "delivered" ? t.confirmMarkDelivered
                          : next === "cancelled" ? t.confirmCancelOrder
                          : next
                      }
                      continueLabel={t.confirmContinue}
                      discardLabel={t.confirmDiscard}
                      disabled={DEMO_MODE}
                      details={[
                        { label: t.confirmSendingTo, value: `${q.company} — ${q.email}`, tech: false },
                        { label: t.confirmOrder, value: q.ref, tech: true },
                        { label: t.confirmNewStatus, value: t[STATUS_LABEL_KEY[next]] },
                      ]}
                      // Courier and tracking are read off the form, so the
                      // summary shows what was actually typed rather than a
                      // promise that something was.
                      echo={
                        next === "shipped"
                          ? [
                              { name: "courier", label: t.courier },
                              { name: "trackingNumber", label: t.trackingNumber, tech: true },
                            ]
                          : []
                      }
                    />
                  </form>
                ))}
              </div>
            )}
            {q.status === "received" ? (
              // A plain GET to the draft: the typed prices ride in its URL, and
              // nothing is written until the draft is finalized.
              <form method="get" action={`/${l}/admin/orders/${q.ref}/invoice`}>
                {statusFilter && <input type="hidden" name="statusFilter" value={statusFilter} />}
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th>{t.partNumber}</th>
                      <th>{t.products}</th>
                      <th className="num">{t.qty}</th>
                      <th className="num">{t.unitPrice} (USD)</th>
                      <th className="num">{t.finalUnitPrice} (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(byOrder.get(q.id) ?? []).map((i) => (
                      <tr key={i.id}>
                        <td className="tech font-bold">{i.partNumber}</td>
                        <td className="whitespace-normal">{i.familyName}</td>
                        <td className="num tech tech-num">{i.qty}</td>
                        <td className="num tech tech-num text-[var(--color-ink-muted)]">
                          {(i.requestedUnitPriceCents / 100).toFixed(2)}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            dir="ltr"
                            name={priceParamName(i.id)}
                            defaultValue={priceParamValue(
                              (q.ref === editRef ? editPrices?.get(i.id) : undefined) ??
                                i.unitPriceCents,
                            )}
                            className="tech w-20 text-end"
                            required
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-2">
                  <button type="submit" className="btn-primary">
                    {t.createInvoice}
                  </button>
                </div>
              </form>
            ) : (
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>{t.partNumber}</th>
                    <th>{t.products}</th>
                    <th className="num">{t.qty}</th>
                    <th className="num">{t.unitPrice}</th>
                    <th className="num">{t.lineTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {(byOrder.get(q.id) ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="tech font-bold">{i.partNumber}</td>
                      <td className="whitespace-normal">{i.familyName}</td>
                      <td className="num tech tech-num">{i.qty}</td>
                      <td className="num tech tech-num">
                        {formatOrderPrice(i.unitPriceCents, q)}
                      </td>
                      <td className="num tech tech-num">
                        {formatOrderPrice(i.unitPriceCents * i.qty, q)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Every order, not only the ones awaiting an invoice. */}
            <NoteLog
              locale={l}
              orderId={q.id}
              statusFilter={statusFilter}
              comments={commentsByOrder.get(q.id) ?? []}
            />
          </div>
        </details>
      ))}
    </>
  );
}

/**
 * The internal note log for one order.
 *
 * Append-only: newest first, nothing editable, no delete. The hint under the
 * heading is load-bearing — someone typing here has to know it never reaches
 * the customer, because the same box on most systems does.
 */
function NoteLog({
  locale,
  orderId,
  statusFilter,
  comments,
}: {
  locale: Locale;
  orderId: number;
  statusFilter: OrderStatus | null;
  comments: OrderComment[];
}) {
  const t = getDict(locale);
  return (
    <section className="mt-3 border-t border-[var(--color-rule)] pt-2">
      <h3 className="text-[11px] font-bold">
        {t.internalNotes}{" "}
        <span className="font-normal text-[var(--color-ink-faint)]">
          — {t.internalNotesHint}
        </span>
      </h3>

      {comments.length === 0 ? (
        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{t.noNotesYet}</p>
      ) : (
        <ul className="mt-1 grid gap-1">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2 text-[11px]">
              <span className="tech shrink-0 text-[var(--color-ink-faint)]">
                {new Date(c.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="whitespace-pre-wrap">{c.body}</span>
            </li>
          ))}
        </ul>
      )}

      <form action={addCommentAction} className="mt-2 flex flex-wrap items-start gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="statusFilter" value={statusFilter ?? ""} />
        <textarea
          name="body"
          rows={2}
          required
          className="min-w-[240px] flex-1 text-[11px]"
          placeholder={t.internalNotes}
        />
        <button type="submit" className="btn-small" disabled={DEMO_MODE}>
          {t.addNote}
        </button>
      </form>
    </section>
  );
}

function Row({ label, value, tech }: { label: string; value: string; tech?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="font-bold">{label}:</dt>
      <dd className={tech ? "tech" : undefined}>{value}</dd>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
      {children}
    </p>
  );
}

function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
      {children}
    </p>
  );
}
