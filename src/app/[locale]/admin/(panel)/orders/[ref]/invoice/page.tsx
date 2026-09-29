import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { notFound, redirect } from "next/navigation";
import { getInvoiceDraft } from "@/db/invoiceQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { getVatRateBp } from "@/lib/vatSettings";
import { getSeller } from "@/lib/seller";
import { getSiteContact } from "@/lib/siteContact";
import { getBankDetails } from "@/lib/bankSettings";
import { siteOrigin } from "@/lib/siteOrigin";
import { DEMO_MODE } from "@/lib/demo";
import { invoiceAmounts, subtotalCents } from "@/lib/invoice";
import { draftLinePrices, draftQuery, priceParamName, priceParamValue } from "@/lib/invoiceDraft";
import { isOrderStatus } from "@/lib/orders";
import { formatAmount, invoiceCurrencyFor } from "@/lib/money";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { InvoiceDraft } from "@/components/InvoiceDraft";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { issueInvoiceAction } from "../../../../actions";

/**
 * The invoice as it will be issued, before it is: the prices typed in the
 * queue (carried in the URL — see `lib/invoiceDraft.ts`), today's exchange
 * rate and today's VAT rate. Finalize posts exactly these figures, and the
 * action refuses them if either rate has moved since this page was drawn.
 *
 * The sign-in gate is `requireAdmin()`, first thing, as on every admin page —
 * the panel layout's check does not stop a page from rendering.
 */
export default async function AdminInvoiceDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  await requireAdmin(l);
  const t = getDict(l);
  const query = await searchParams;
  const statusFilter =
    typeof query.statusFilter === "string" && isOrderStatus(query.statusFilter)
      ? query.statusFilter
      : "";
  const cur = typeof query.cur === "string" ? query.cur : "";
  const queue = `/${l}/admin/orders${statusFilter ? `?status=${statusFilter}` : ""}`;

  const [found, rate, vatRateBp, priceDisplayMode, contact, bank, origin] = await Promise.all([
    getInvoiceDraft(ref),
    getFxRate(),
    getVatRateBp(),
    getPriceDisplayMode(),
    getSiteContact(),
    getBankDetails(l),
    siteOrigin(),
  ]);
  if (!found) notFound();
  const { order, items } = found;
  // Invoiced meanwhile — by a rep, or in another tab: show what was issued.
  if (order.status !== "received") {
    redirect(order.status === "cancelled" ? queue : `/${l}/invoice/${order.ref}`);
  }

  const prices = draftLinePrices(query, items);
  if (!prices) {
    redirect(`/${l}/admin/orders?error=prices${statusFilter ? `&status=${statusFilter}` : ""}`);
  }
  const lines = items.map((item) => ({ ...item, unitPriceCents: prices.get(item.id)! }));
  const totalCents = subtotalCents(lines);
  const currency = invoiceCurrencyFor(priceDisplayMode, l, cur);
  const due = invoiceAmounts(totalCents, vatRateBp, currency, rate).total;
  const otherCurrency = currency === "USD" ? "IRR" : "USD";

  return (
    <InvoiceDraft
      locale={l}
      changed={query.changed === "1"}
      actions={
        <>
          <form action={issueInvoiceAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="statusFilter" value={statusFilter} />
            <input type="hidden" name="cur" value={cur} />
            {/* The rates this page was drawn at; the action refuses any other. */}
            <input type="hidden" name="rate" value={rate} />
            <input type="hidden" name="vatRateBp" value={vatRateBp} />
            {lines.map((line) => (
              <input
                key={line.id}
                type="hidden"
                name={priceParamName(line.id)}
                value={priceParamValue(line.unitPriceCents)}
              />
            ))}
            <ConfirmSubmit
              label={t.finalizeInvoice}
              title={t.confirmFinalizeInvoice}
              continueLabel={t.confirmContinue}
              discardLabel={t.confirmDiscard}
              disabled={DEMO_MODE}
              className="btn-primary"
              details={[
                { label: t.confirmSendingTo, value: `${order.company} — ${order.contactName}` },
                { label: t.email, value: order.email, tech: true },
                { label: t.confirmOrder, value: order.ref, tech: true },
                { label: t.confirmInvoiceTotal, value: formatAmount(due, currency, l), tech: true },
              ]}
            />
          </form>
          <Link href={`/${l}/admin/orders?${draftQuery(prices, { status: statusFilter, edit: order.ref })}`}>
            {t.changePrices}
          </Link>
          {/* Only when customers may switch currency on the issued invoice. */}
          {priceDisplayMode === "both" && (
            <Link
              href={`/${l}/admin/orders/${order.ref}/invoice?${draftQuery(prices, {
                statusFilter,
                cur: otherCurrency,
              })}`}
              className="tech"
            >
              {otherCurrency}
            </Link>
          )}
        </>
      }
    >
      <InvoiceDocument
        locale={l}
        seller={{ ...getSeller(l), email: contact.email, phone: contact.phone }}
        order={order}
        items={lines}
        totalCents={totalCents}
        currency={currency}
        rate={rate}
        vatRateBp={vatRateBp}
        invoiceNumber={null}
        date={new Date()}
        bank={bank}
        proofUrl={`${origin}/${l}/pay/${order.payToken}`}
      />
    </InvoiceDraft>
  );
}
