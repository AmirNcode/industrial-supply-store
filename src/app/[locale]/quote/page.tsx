import { notFound, redirect } from "next/navigation";
import { getCartId, getCartLines, unitPriceAt } from "@/lib/cart";
import { submitQuoteAction } from "@/app/actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { DEMO_MODE } from "@/lib/demo";
import { customerCurrencyFor } from "@/lib/money";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { currentUser } from "@/lib/session";
import { currentRep } from "@/lib/repSession";
import { getCustomerForRep, listCustomersForRep } from "@/db/customerQueries";
import { readOrderingFor } from "@/lib/repOrderContext";
import { isUuid } from "@/lib/ids";
import { RepQuoteForm } from "./RepQuoteForm";
import { AUTH_SECRET } from "@/lib/authSecret";
import {
  createQuoteSubmission,
  quoteCartFingerprint,
  signQuoteSubmissionToken,
} from "@/lib/quoteSubmission";
import QuoteSubmitButton from "@/components/QuoteSubmitButton";
import { splitCart } from "@/lib/checkoutSplit";
import { pishFactorTerms, runExpirySweep } from "@/lib/orderFlow";
import { listAddresses } from "@/db/addressQueries";
import { DeliveryFields, ErrorNote, Field, NotesField, OrderSummary, TaxFields, checkoutView } from "./CheckoutParts";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; for?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error, for: forParam } = await searchParams;

  // Before the cart is read: a lapsed hold must be back on the shelf first.
  await runExpirySweep();
  const [lines, rate, priceDisplayMode, user, cartId, rep, terms] = await Promise.all([
    getCartLines(),
    getFxRate(),
    getPriceDisplayMode(),
    currentUser(),
    getCartId(),
    currentRep(),
    pishFactorTerms(),
  ]);
  if (lines.length === 0) redirect(`/${l}/cart`);
  if (!cartId) redirect(`/${l}/cart`);
  const currency = customerCurrencyFor(priceDisplayMode, l);
  const split = splitCart(
    lines.map((x) => ({
      productId: x.productId,
      qty: x.qty,
      unitPriceCents: unitPriceAt(x, x.qty),
      inStock: x.inStock,
      available: x.available,
    })),
  );
  const canIssue = terms !== null;
  const view = checkoutView(split, canIssue);
  const parts = Object.fromEntries(lines.map((x) => [x.productId, x.partNumber]));
  // The split lines, not the bare cart lines: the server compares payNow and
  // heldForQuote too, so a stock change since this page was drawn is caught.
  const fingerprint = quoteCartFingerprint(split.lines);
  const submissionToken = signQuoteSubmissionToken(
    createQuoteSubmission(cartId, fingerprint),
    AUTH_SECRET,
  );

  // A signed-in rep checks out for one of their customers, on its own form.
  if (rep) {
    if (rep.mustChangePassword) redirect(`/${l}/rep/password`);
    const wanted =
      (typeof forParam === "string" && isUuid(forParam) ? forParam : null) ??
      (await readOrderingFor());
    // The chosen customer is loaded on its own, not looked up in the picker's
    // list: the list stops at 500, and a rep pressing "New order" on customer
    // 550 used to land here with nobody selected (review M-15).
    const [listed, selected] = await Promise.all([
      listCustomersForRep(rep.id, ""),
      wanted ? getCustomerForRep(rep.id, wanted) : Promise.resolve(null),
    ]);
    const customers = selected && !listed.some((c) => c.id === selected.id) ? [selected, ...listed] : listed;
    return (
      <RepQuoteForm
        locale={l}
        customers={customers}
        selected={selected}
        split={split}
        parts={parts}
        canIssue={canIssue}
        vatRateBp={terms?.vatRateBp ?? null}
        rate={terms?.rate ?? rate}
        submissionToken={submissionToken}
        error={error}
      />
    );
  }

  const saved = user ? await listAddresses(user.id) : [];
  const payable = view.kind !== "quote";
  const title = payable ? t.checkoutTitle : t.requestAQuote;
  const intro =
    view.kind === "instant"
      ? t.checkoutIntroInstant
      : view.kind === "mixed"
        ? t.checkoutIntroMixed
        : t.checkoutIntroQuote;

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">{title}</h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{intro}</p>

      {/* Shown before the form, not after: the point is to inform the decision
          to type real details, which is too late once they are submitted. */}
      {DEMO_MODE && (
        <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--color-warn)]">
          {t.demoQuoteWarning}
        </p>
      )}

      {error === "missing" && <ErrorNote>{t.deliveryRequired}</ErrorNote>}
      {error === "expired" && <ErrorNote>{t.quoteFormExpired}</ErrorNote>}
      {error === "cart-changed" && <ErrorNote>{t.checkoutStockChanged}</ErrorNote>}
      {error === "too-large" && <ErrorNote>{t.orderTooLarge}</ErrorNote>}
      {(error === "invalid" || error === "rate-limit") && (
        <ErrorNote>{error === "rate-limit" ? t.rateLimited : t.invalidInput}</ErrorNote>
      )}

      <form action={submitQuoteAction} className="grid gap-4 md:grid-cols-[1fr_300px]">
        <input type="hidden" name="locale" value={l} />
        <input type="hidden" name="submissionToken" value={submissionToken} />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] self-start">
          <Field name="company" label={t.company} maxLength={REQUEST_LIMITS.companyChars} required defaultValue={user?.company} />
          <Field name="contactName" label={t.contactName} maxLength={REQUEST_LIMITS.contactNameChars} required defaultValue={user?.contactName} />
          {/* Required only from a guest, whose pish-factor and account come
              from it; a signed-in customer's order sits on their account. */}
          <Field
            name="email"
            label={t.email}
            type="email"
            maxLength={REQUEST_LIMITS.emailChars}
            required={!user}
            optional={user ? t.optional : undefined}
            defaultValue={user?.email ?? undefined}
          />
          <Field name="phone" label={t.phone} type="tel" maxLength={REQUEST_LIMITS.phoneChars} required defaultValue={user?.phone} />
          <Field name="poNumber" label={t.poNumber} maxLength={REQUEST_LIMITS.poNumberChars} optional={t.optional} defaultValue={user?.defaultPoNumber} />
          <DeliveryFields locale={l} saved={saved} canSave={!!user} />
          <TaxFields locale={l} defaults={{ nationalId: user?.nationalId, economicCode: user?.economicCode }} />
          <NotesField locale={l} />
          {!user && <p className="col-span-full text-[11px] text-[var(--color-ink-muted)]">{t.checkoutAccountNote}</p>}
        </div>

        <OrderSummary
          locale={l}
          split={split}
          canIssue={canIssue}
          vatRateBp={terms?.vatRateBp ?? null}
          currency={currency}
          rate={terms?.rate ?? rate}
          parts={parts}
          submit={<QuoteSubmitButton label={payable ? t.placeOrder : t.submitRequest} />}
        />
      </form>
    </main>
  );
}
