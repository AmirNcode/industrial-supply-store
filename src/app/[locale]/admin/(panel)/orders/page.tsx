import { notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "@/db";
import { DEMO_MODE } from "@/lib/demo";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";
import { getFxRate } from "@/lib/fx";
import { cookies } from "next/headers";
import { emailsWithAccounts } from "@/db/userQueries";
import { OrderStatusPill, STATUS_LABEL_KEY } from "@/components/OrderStatusPill";
import {
  issueInvoiceAction,
  setOrderStatusAction,
  resetCustomerPasswordAction,
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
  fxRateToToman: number | null;
  paymentUrl: string;
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
  searchParams: Promise<{ error?: string; fx?: string; ok?: string; status?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const sp = await searchParams;
  const { error, fx, ok } = sp;
  // Read from a 30-second cookie the reset action set, so the credential never
  // travels in a URL or reaches an access log.
  const newPassword =
    ok === "password" ? (await cookies()).get("isupply_new_password")?.value : undefined;
  const statusFilter = typeof sp.status === "string" && isOrderStatus(sp.status)
    ? sp.status
    : null;

  // The sign-in gate lives in the panel layout, which wraps this page.
  const rate = await getFxRate();

  const orders = await sql<OrderRow[]>`
    SELECT q.id, q.ref, q.company, q.contact_name AS "contactName", q.email,
           q.phone, q.po_number AS "poNumber", q.city, q.country, q.notes,
           q.status, q.locale, q.currency, q.total_cents AS "totalCents",
           q.created_at AS "createdAt", q.courier,
           q.tracking_number AS "trackingNumber",
           q.invoice_number AS "invoiceNumber",
           q.fx_rate_to_toman AS "fxRateToToman",
           q.payment_url AS "paymentUrl",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = q.id) AS "itemCount"
    FROM orders q
    ${statusFilter ? sql`WHERE q.status = ${statusFilter}` : sql`WHERE q.status <> 'delivered' AND q.status <> 'cancelled'`}
    ORDER BY q.created_at DESC LIMIT 200
  `;

  const items = orders.length
    ? await sql<OrderItemRow[]>`
        SELECT id, order_id AS "orderId", part_number AS "partNumber",
               family_name AS "familyName", qty,
               unit_price_cents AS "unitPriceCents",
               requested_unit_price_cents AS "requestedUnitPriceCents",
               specs_snapshot AS "specsSnapshot"
        FROM order_items WHERE order_id = ANY(${orders.map((q) => q.id)})
        ORDER BY id
      `
    : [];

  // One query for the whole page rather than a lookup per row: staff can only
  // reset a password for an address that actually has an account.
  const withAccounts = await emailsWithAccounts(orders.map((o) => o.email));

  const byOrder = new Map<number, OrderItemRow[]>();
  for (const i of items) {
    if (!byOrder.has(i.orderId)) byOrder.set(i.orderId, []);
    byOrder.get(i.orderId)!.push(i);
  }

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
      {ok === "invoiced" && <SuccessBanner>{t.invoiceIssued}</SuccessBanner>}
      {error === "payment-link" && <ErrorBanner>{t.paymentLinkRequired}</ErrorBanner>}
      {error === "prices" && <ErrorBanner>{t.pricesRequired}</ErrorBanner>}
      {error === "tracking" && <ErrorBanner>{t.trackingRequired}</ErrorBanner>}
      {error === "not-found" && <ErrorBanner>{t.orderNotFound}</ErrorBanner>}
      {error === "no-account" && <ErrorBanner>{t.noAccountForEmail}</ErrorBanner>}
      {newPassword && (
        <p className="mb-2 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          <strong>{t.newPasswordOnce}</strong>{" "}
          <span className="tech select-all text-[14px] font-bold">{newPassword}</span>
        </p>
      )}
      {error === "conflict" && <ErrorBanner>{t.orderConflict}</ErrorBanner>}
      {error === "bad-request" && <ErrorBanner>{t.badRequest}</ErrorBanner>}

      {orders.length === 0 && (
        <p className="py-8 text-[13px] text-[var(--color-ink-muted)]">{t.noQuotes}</p>
      )}

      {orders.map((q) => (
        <details key={q.id} className="mb-2 border border-[var(--color-rule)]">
          <summary className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-[var(--color-panel-alt)] px-3 py-2 text-[12px] cursor-pointer">
            <strong className="tech">{q.ref}</strong>
            <OrderStatusPill locale={l} status={q.status} />
            <span>{q.company}</span>
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
                priced yet, which is exactly when fxRateToToman is still
                null. */}
            <span className="tech font-bold">
              {formatPrice(q.totalCents, q.locale === "fa" ? "fa" : "en", q.fxRateToToman ?? rate)}
            </span>
          </summary>

          <div className="px-3 py-2">
            <dl className="mb-2 grid gap-x-6 gap-y-0.5 text-[11px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              {q.phone && <Row label={t.phone} value={q.phone} tech />}
              {q.poNumber && <Row label={t.poNumber} value={q.poNumber} tech />}
              {withAccounts.has(q.email.toLowerCase()) && (
                <div className="flex items-baseline gap-1.5">
                  <dt className="font-bold">{t.account}:</dt>
                  <dd>
                    <form action={resetCustomerPasswordAction} className="inline">
                      <input type="hidden" name="locale" value={l} />
                      <input type="hidden" name="email" value={q.email} />
                      <button
                        type="submit"
                        className="underline disabled:no-underline disabled:opacity-50"
                        disabled={DEMO_MODE}
                      >
                        {t.resetPassword}
                      </button>
                    </form>
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
              {q.paymentUrl && <Row label={t.paymentLink} value={q.paymentUrl} tech />}
            </dl>
            {q.notes && (
              <p className="mb-2 whitespace-pre-wrap border-s-2 border-[var(--color-rule)] ps-2 text-[11px] text-[var(--color-ink-muted)]">
                {q.notes}
              </p>
            )}
            {/* 'invoiced' is a legal next status from 'received', but no button
                renders for it here: issuing an invoice needs prices and a
                payment link, which only issueInvoiceAction (Task 9) has. */}
            {nextStatuses(q.status).filter((s) => s !== "invoiced").length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {nextStatuses(q.status).filter((s) => s !== "invoiced").map((next) => (
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
                        <input name="courier" placeholder={t.courier} className="w-28 text-[11px]" required />
                        <input name="trackingNumber" dir="ltr" placeholder={t.trackingNumber} className="tech w-36 text-[11px]" required />
                      </>
                    )}
                    <button type="submit" className="btn-small" disabled={DEMO_MODE}>
                      {next === "preparing" ? t.markPaid
                        : next === "shipped" ? t.markShipped
                        : next === "delivered" ? t.markDelivered
                        : next === "cancelled" ? t.cancelOrder
                        : next}
                    </button>
                  </form>
                ))}
              </div>
            )}
            {q.status === "received" ? (
              <form action={issueInvoiceAction}>
                <input type="hidden" name="locale" value={l} />
                <input type="hidden" name="orderId" value={q.id} />
                <input type="hidden" name="statusFilter" value={statusFilter ?? ""} />
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th>{t.partNumber}</th>
                      <th>{t.products}</th>
                      <th className="num">{t.qty}</th>
                      <th className="num">{t.unitPrice}</th>
                      <th className="num">{t.finalUnitPrice}</th>
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
                            min="0"
                            dir="ltr"
                            name={`price_${i.id}`}
                            defaultValue={(i.unitPriceCents / 100).toFixed(2)}
                            className="tech w-20 text-end"
                            required
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    name="paymentUrl"
                    dir="ltr"
                    placeholder={t.paymentLink}
                    className="w-72 text-[11px]"
                    required
                  />
                  <button type="submit" className="btn-primary" disabled={DEMO_MODE}>
                    {t.issueInvoice}
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
                        {formatPrice(i.unitPriceCents, q.locale === "fa" ? "fa" : "en", q.fxRateToToman ?? rate)}
                      </td>
                      <td className="num tech tech-num">
                        {formatPrice(i.unitPriceCents * i.qty, q.locale === "fa" ? "fa" : "en", q.fxRateToToman ?? rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>
      ))}
    </>
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
