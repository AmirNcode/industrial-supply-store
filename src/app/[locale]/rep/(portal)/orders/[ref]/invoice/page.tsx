import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { repCanSeeOrder } from "@/db/repOrderQueries";
import { getInvoiceDraft } from "@/db/invoiceQueries";
import { getFxRate } from "@/lib/fx";
import { getVatRateBp } from "@/lib/vatSettings";
import { getSeller } from "@/lib/seller";
import { getSiteContact } from "@/lib/siteContact";
import { getBankDetails } from "@/lib/bankSettings";
import { siteOrigin } from "@/lib/siteOrigin";
import { invoiceAmounts, subtotalCents } from "@/lib/invoice";
import { formatAmount } from "@/lib/money";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { InvoiceDraft } from "@/components/InvoiceDraft";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { issueInvoiceForRepAction } from "../../../../actions";

/**
 * A rep's draft invoice: the order at the prices it was placed at, today's
 * exchange rate and VAT rate, in rial — reps never see dollar amounts.
 * Finalize posts the figures shown, and the action refuses them if anything
 * has moved since.
 */
export default async function RepInvoiceDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<{ changed?: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { changed } = await searchParams;
  const rep = await requireRep(l);

  // 404 for an order this rep may not see, as on the order page itself.
  if (!(await repCanSeeOrder(rep.id, ref))) notFound();
  const [found, rate, vatRateBp, contact, bank, origin] = await Promise.all([
    getInvoiceDraft(ref),
    getFxRate(),
    getVatRateBp(),
    getSiteContact(),
    getBankDetails(l),
    siteOrigin(),
  ]);
  if (!found) notFound();
  const { order, items } = found;
  const orderPage = `/${l}/rep/orders/${order.ref}`;
  // Invoiced meanwhile — by the admin, or in another tab.
  if (order.status !== "received") redirect(orderPage);

  const totalCents = subtotalCents(items);
  const due = invoiceAmounts(totalCents, vatRateBp, "IRR", rate).total;

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={orderPage} dir="ltr">
          ← {order.ref}
        </Link>
      </p>
      <InvoiceDraft
        locale={l}
        changed={changed === "1"}
        actions={
          <form action={issueInvoiceForRepAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="ref" value={order.ref} />
            {/* What this page showed; the action refuses anything else. */}
            <input type="hidden" name="rate" value={rate} />
            <input type="hidden" name="vatRateBp" value={vatRateBp} />
            <input type="hidden" name="subtotalCents" value={totalCents} />
            <ConfirmSubmit
              label={t.finalizeInvoice}
              title={t.confirmFinalizeInvoice}
              continueLabel={t.confirmContinue}
              discardLabel={t.confirmDiscard}
              className="btn-primary"
              details={[
                { label: t.confirmSendingTo, value: `${order.company} — ${order.contactName}` },
                { label: t.confirmOrder, value: order.ref, tech: true },
                { label: t.confirmInvoiceTotal, value: formatAmount(due, "IRR", l), tech: true },
              ]}
            />
          </form>
        }
      >
        <InvoiceDocument
          locale={l}
          seller={{ ...getSeller(l), email: contact.email, phone: contact.phone }}
          order={order}
          items={items}
          totalCents={totalCents}
          currency="IRR"
          rate={rate}
          vatRateBp={vatRateBp}
          invoiceNumber={null}
          date={new Date()}
          bank={bank}
          proofUrl={`${origin}/${l}/pay/${order.payToken}`}
        />
      </InvoiceDraft>
    </>
  );
}
