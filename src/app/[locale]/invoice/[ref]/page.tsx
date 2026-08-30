import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceByRef } from "@/db/invoiceQueries";
import { lineTotalCents, subtotalCents } from "@/lib/invoice";
import { getSeller } from "@/lib/seller";
import { getSiteContact } from "@/lib/siteContact";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { currentUserId } from "@/lib/session";
import { PrintButton } from "@/components/PrintButton";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { getPriceDisplayMode } from "@/lib/fx";
import {
  formatMoneyExact,
  formatInt,
  invoiceCurrencyFor,
  type Currency,
} from "@/lib/money";

/**
 * The invoice document.
 *
 * Two things about this page are load-bearing.
 *
 * The rate comes off the order, not from `getFxRate()`. It was frozen when the
 * invoice was issued so that reprinting a month later cannot change what is
 * owed; reading the live rate here would undo that silently, and the number
 * would look perfectly reasonable while being wrong.
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
  searchParams: Promise<{ cur?: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const { cur } = await searchParams;

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
  if (!staff && !uid) notFound();

  const [found, contact, priceDisplayMode] = await Promise.all([
    getInvoiceByRef(ref),
    getSiteContact(),
    getPriceDisplayMode(),
  ]);
  if (!found) notFound();
  const { order, items } = found;

  if (!staff && (order.userId === null || order.userId !== uid)) notFound();

  const currency = invoiceCurrencyFor(priceDisplayMode, l, cur);
  const other: Locale = l === "fa" ? "en" : "fa";
  const otherCurrency: Currency = currency === "USD" ? "IRR" : "USD";
  const languageHref = `/${other}/invoice/${order.ref}${
    priceDisplayMode === "both" ? `?cur=${currency}` : ""
  }`;
  const rate = order.fxRateToRial;
  const seller = { ...getSeller(l), email: contact.email, phone: contact.phone };
  const subtotal = subtotalCents(items);
  const issued = new Date(order.invoicedAt).toISOString().slice(0, 10);
  // `invoiced → cancelled` is one click in the admin queue, and the emailed
  // link keeps working afterwards. A voided invoice that still shows a total
  // and a live payment link is how someone pays for a cancelled order.
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
              href={`/${l}/invoice/${order.ref}?cur=${otherCurrency}`}
              prefetch={false}
              className="tech"
            >
              {otherCurrency}
            </Link>
          )}
        </span>
      </div>

      <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-[var(--color-ink)] pb-4">
        <div>
          <h1 className="text-[26px] font-bold text-[var(--color-navy)]">{t.invoice}</h1>
          <p className="tech mt-1 text-[15px] font-bold">{order.invoiceNumber}</p>
          {cancelled && (
            <p className="mt-1 text-[15px] font-bold text-[var(--color-danger)]">
              {t.invoiceCancelled}
            </p>
          )}
        </div>
        <div className="text-end text-[12px] leading-relaxed">
          {/* The full lockup earns its place here: white paper, printed at a
              size where the wordmark actually reads. `print-color-adjust`
              keeps the yellow when the browser would otherwise drop
              backgrounds from a print. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/temex-logo.svg"
            alt={seller.name}
            width={132}
            height={132}
            className="mb-2 ms-auto block h-[52px] w-[52px]"
            style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
          />
          <p className="font-bold">{seller.name}</p>
          {seller.addressLines.map((line, i) => (
            <p key={i} className="text-[var(--color-ink-muted)]">{line}</p>
          ))}
          <p className="tech text-[var(--color-ink-muted)]">{seller.email}</p>
          <p className="tech text-[var(--color-ink-muted)]">{seller.phone}</p>
          {seller.taxId && (
            <p className="text-[var(--color-ink-muted)]">
              {t.invoiceTaxId}: <span className="tech">{seller.taxId}</span>
            </p>
          )}
        </div>
      </header>

      <section className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            {t.invoiceTo}
          </h2>
          <p className="text-[14px] font-bold">{order.company}</p>
          <p className="text-[12px]">{order.contactName}</p>
          {order.address && <p className="text-[12px]">{order.address}</p>}
          {(order.city || order.country) && (
            <p className="text-[12px]">{[order.city, order.country].filter(Boolean).join(", ")}</p>
          )}
          <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.email}</p>
          {order.phone && (
            <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.phone}</p>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 self-start text-[12px] sm:justify-self-end">
          <dt className="font-bold">{t.invoiceDate}</dt>
          <dd className="tech">{issued}</dd>
          <dt className="font-bold">{t.invoiceOrderRef}</dt>
          <dd className="tech">{order.ref}</dd>
          {order.poNumber && (
            <>
              <dt className="font-bold">{t.poNumber}</dt>
              <dd className="tech">{order.poNumber}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="invoice-table w-full">
        <thead>
          <tr>
            <th className="text-start">{t.partNumber}</th>
            <th className="text-start">{t.invoiceDescription}</th>
            <th className="num">{t.qty}</th>
            <th className="num">{t.unitPrice}</th>
            <th className="num">{t.invoiceLineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="tech font-semibold">{i.partNumber}</td>
              <td>{i.familyName}</td>
              <td className="num tech tech-num">{formatInt(i.qty, l)}</td>
              <td className="num tech tech-num">{formatMoneyExact(i.unitPriceCents, currency, l, rate)}</td>
              <td className="num tech tech-num">
                {formatMoneyExact(lineTotalCents(i), currency, l, rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-full max-w-[280px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
          <dt>{t.invoiceSubtotal}</dt>
          <dd className="num tech tech-num">{formatMoneyExact(subtotal, currency, l, rate)}</dd>
          <dt className="border-t border-[var(--color-ink)] pt-1.5 font-bold">
            {cancelled ? t.invoiceVoid : t.invoiceTotal}
          </dt>
          <dd className="num tech tech-num border-t border-[var(--color-ink)] pt-1.5 text-[15px] font-bold">
            {formatMoneyExact(order.totalCents, currency, l, rate)}
          </dd>
        </dl>
      </section>

      {order.paymentUrl && !cancelled && (
        <p className="mt-6 text-[12px]">
          <a href={order.paymentUrl} className="font-bold" rel="noopener noreferrer">
            {t.invoicePay}
          </a>{" "}
          <span className="tech break-all text-[var(--color-ink-faint)]">{order.paymentUrl}</span>
        </p>
      )}

      <footer className="mt-8 border-t border-[var(--color-rule)] pt-3 text-[11px] text-[var(--color-ink-muted)]">
        <p>{t.invoiceThanks}</p>
        {/* Keyed on the currency shown, not the language. An English invoice
            priced in Rial is converted and must say so; a Persian invoice
            priced in dollars is not, and the note would be a lie. */}
        {currency === "IRR" && (
          <p className="mt-1">
            {t.invoiceFxNote}{" "}
            <span className="tech">{formatInt(rate, l)}</span> {t.fxPerUsd}
          </p>
        )}
      </footer>

      <div className="mt-6 flex justify-end no-print">
        <PrintButton locale={l} />
      </div>
    </main>
  );
}
