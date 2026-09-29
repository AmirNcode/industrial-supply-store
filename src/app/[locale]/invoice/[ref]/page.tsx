import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceByRef } from "@/db/invoiceQueries";
import { getSeller } from "@/lib/seller";
import { getSiteContact } from "@/lib/siteContact";
import { getBankDetails } from "@/lib/bankSettings";
import { siteOrigin } from "@/lib/siteOrigin";
import { acceptsPaymentProof, isOrderStatus } from "@/lib/orders";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { currentUserId } from "@/lib/session";
import { isPayToken, payTokensEqual } from "@/lib/payToken";
import { PrintButton } from "@/components/PrintButton";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { getPriceDisplayMode } from "@/lib/fx";
import { invoiceCurrencyFor, type Currency } from "@/lib/money";

/**
 * The invoice document.
 *
 * Two things about this page are load-bearing.
 *
 * The rate comes off the order, not from `getFxRate()`. It was frozen when the
 * invoice was issued so that reprinting a month later cannot change what is
 * owed; reading the live rate here would undo that silently, and the number
 * would look perfectly reasonable while being wrong. VAT comes off the order
 * for the same reason, never from the current setting.
 *
 * The language comes from the path segment, not from the order. Staff email
 * whichever version the customer reads, and the same order can legitimately be
 * printed in both.
 *
 * Language and currency are chosen separately. Language stays in the path so
 * the document's direction and the layout's `dir` follow it for free; currency
 * is a query parameter on top. A Tehran buyer may want Persian text priced in
 * dollars because that is what the contract says, or an English document
 * priced in the Rial they will actually pay. The admin setting decides whether
 * that choice exists at all.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  // Keep this currency-neutral. Resolving the real currency here would require
  // a settings query before the page's access check, while trusting `?cur=`
  // would let a conflicting URL mislabel a USD-locked invoice as IRR (or the
  // reverse) in the browser and saved-PDF filename.
  const { ref } = await params;
  return { title: `Invoice ${ref}` };
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<{ cur?: string; key?: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const { cur, key } = await searchParams;
  // A pay link carries its order's key. Its shape is checked before any query,
  // like the signed-out refusal below, so junk costs nothing and says nothing.
  const payKey = typeof key === "string" && isPayToken(key) ? key : null;

  /*
   * Staff may read any invoice; a customer may read one that is theirs.
   *
   * A guest order has no owner, so its invoice stays staff-only and reaches
   * the customer as a PDF a human attached to an email. DEMO_MODE matches
   * /admin, where the whole inbox is already public and the RFQ form says so
   * before anyone types.
   *
   * 404 rather than 403: a 403 would confirm the reference exists.
   */
  const [staff, uid] = await Promise.all([
    DEMO_MODE ? Promise.resolve(true) : isAdmin(),
    currentUserId(),
  ]);

  // Refused before any query, so an anonymous request costs the same whether
  // the reference exists or not. Checking after the fetch would make the 404
  // latency an existence oracle over a six-character reference — exactly the
  // confirmation "404, not 403" exists to withhold, and it would let
  // unauthenticated traffic drive unbounded database load.
  if (!staff && !uid && !payKey) notFound();

  const [found, contact, priceDisplayMode, bank, origin] = await Promise.all([
    getInvoiceByRef(ref),
    getSiteContact(),
    getPriceDisplayMode(),
    getBankDetails(l),
    siteOrigin(),
  ]);
  if (!found) notFound();
  const { order, items } = found;

  const owner = uid !== null && order.userId !== null && order.userId === uid;
  const keyed = payKey !== null && payTokensEqual(payKey, order.payToken);
  // 404 rather than 403, as before: a key for another order confirms nothing.
  if (!staff && !owner && !keyed) notFound();

  const currency = invoiceCurrencyFor(priceDisplayMode, l, cur);
  const other: Locale = l === "fa" ? "en" : "fa";
  const otherCurrency: Currency = currency === "USD" ? "IRR" : "USD";
  // The switch links keep the pay link's key, or a customer who opened the
  // invoice from it would lose access the moment they change language.
  const withKey = (query: Record<string, string>) => {
    const next = new URLSearchParams(query);
    if (keyed && payKey) next.set("key", payKey);
    const qs = next.toString();
    return qs ? `?${qs}` : "";
  };
  const languageHref = `/${other}/invoice/${order.ref}${withKey(
    priceDisplayMode === "both" ? { cur: currency } : {},
  )}`;
  const seller = { ...getSeller(l), email: contact.email, phone: contact.phone };
  // `invoiced → cancelled` is one click in the admin queue, and the emailed
  // link keeps working afterwards. A voided invoice that still reads as an
  // amount due is how someone pays for a cancelled order.
  const cancelled = order.status === "cancelled";

  return (
    <main className="invoice-sheet mx-auto max-w-[820px] px-6 py-8">
      {/* Plain links, not a form: each combination is its own URL, so a staff
          member can bookmark or paste "the Persian one priced in dollars" and
          the printed PDF matches what the link says. `no-print` keeps the
          controls off the document itself. */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--color-rule)] bg-[var(--color-panel-alt)] px-3 py-2 text-[12px]">
        <span className="flex items-center gap-2">
          <span className="font-bold">{t.languagePreference}:</span>
          <span>{l === "fa" ? t.persian : t.english}</span>
          <Link href={languageHref} prefetch={false}>
            {other === "fa" ? t.persian : t.english}
          </Link>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-bold">{t.invoiceCurrency}:</span>
          <span className="tech">{currency}</span>
          {priceDisplayMode === "both" && (
            <Link
              href={`/${l}/invoice/${order.ref}${withKey({ cur: otherCurrency })}`}
              prefetch={false}
              className="tech"
            >
              {otherCurrency}
            </Link>
          )}
        </span>
      </div>

      <InvoiceDocument
        locale={l}
        seller={seller}
        order={order}
        items={items}
        totalCents={order.totalCents}
        currency={currency}
        rate={order.fxRateToRial}
        vatRateBp={order.vatRateBp}
        invoiceNumber={order.invoiceNumber}
        date={order.invoicedAt}
        cancelled={cancelled}
        bank={bank}
        // The pay page, not the account page: it needs no sign-in, so the
        // same address works for a guest, a rep's customer and a printout.
        proofUrl={
          isOrderStatus(order.status) && acceptsPaymentProof(order.status)
            ? `${origin}/${l}/pay/${order.payToken}`
            : null
        }
      />

      <div className="mt-6 flex justify-end no-print">
        <PrintButton locale={l} />
      </div>
    </main>
  );
}
