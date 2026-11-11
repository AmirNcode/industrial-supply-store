import Link from "next/link";
import { submitQuoteAction } from "@/app/actions";
import { getDict, type Locale } from "@/lib/i18n";
import type { CartSplit } from "@/lib/checkoutSplit";
import type { CustomerRow } from "@/db/customerQueries";
import QuoteSubmitButton from "@/components/QuoteSubmitButton";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { DeliveryFields, ErrorNote, Field, NotesField, OrderSummary, TaxFields } from "./CheckoutParts";

const ERROR_KEY = {
  missing: "deliveryRequired",
  expired: "quoteFormExpired",
  "cart-changed": "checkoutStockChanged",
  invalid: "invalidInput",
  "rate-limit": "rateLimited",
  customer: "customerNotYours",
} as const;

/**
 * Checkout as a rep sees it: first which customer the order is for, then that
 * customer's details, prefilled and editable for this one order. Choosing the
 * customer is a plain GET, so it works before any JavaScript and the choice
 * is in the URL; the order itself posts to the same action as every checkout,
 * which re-checks that the customer is still this rep's. Money is always in
 * rial: reps never see dollar amounts.
 */
export function RepQuoteForm({
  locale,
  customers,
  selected,
  split,
  parts,
  canIssue,
  vatRateBp,
  rate,
  submissionToken,
  error,
}: {
  locale: Locale;
  customers: CustomerRow[];
  selected: CustomerRow | null;
  split: CartSplit;
  parts: Record<number, string>;
  canIssue: boolean;
  vatRateBp: number | null;
  rate: number;
  submissionToken: string;
  error?: string;
}) {
  const t = getDict(locale);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3">
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.repOrderForCustomer}
      </h1>

      {errorKey && (
        <ErrorNote>{t[errorKey]}</ErrorNote>
      )}

      {customers.length === 0 ? (
        <p className="mb-4 text-[13px]">
          {t.repNoCustomersYet}{" "}
          <Link href={`/${locale}/rep/customers/new`}>{t.newCustomer}</Link>
        </p>
      ) : (
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <select
            name="for"
            defaultValue={selected?.id ?? ""}
            aria-label={t.chooseCustomer}
            className="min-w-[240px] max-w-full"
          >
            <option value="">{t.chooseCustomer}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.company} — {customer.customerCode}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-small">
            {t.useCustomer}
          </button>
        </form>
      )}

      {selected && (
        <form action={submitQuoteAction} className="grid gap-4 md:grid-cols-[1fr_300px]">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="submissionToken" value={submissionToken} />
          <input type="hidden" name="forCustomerId" value={selected.id} />

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] self-start">
            <Field name="company" label={t.company} maxLength={REQUEST_LIMITS.companyChars} required defaultValue={selected.company} />
            <Field name="contactName" label={t.contactName} maxLength={REQUEST_LIMITS.contactNameChars} required defaultValue={selected.contactName} />
            <Field name="email" label={t.email} type="email" maxLength={REQUEST_LIMITS.emailChars} optional={t.optional} defaultValue={selected.email ?? ""} />
            <Field name="phone" label={t.phone} type="tel" maxLength={REQUEST_LIMITS.phoneChars} required defaultValue={selected.phone} />
            <Field name="poNumber" label={t.poNumber} maxLength={REQUEST_LIMITS.poNumberChars} optional={t.optional} defaultValue={selected.defaultPoNumber} />
            <DeliveryFields locale={locale} defaults={{ address: selected.address, city: selected.city }} />
            <TaxFields locale={locale} />
            <NotesField locale={locale} />
          </div>

          <OrderSummary
            locale={locale}
            split={split}
            canIssue={canIssue}
            vatRateBp={vatRateBp}
            currency="IRR"
            rate={rate}
            parts={parts}
            submit={<QuoteSubmitButton label={t.repPlaceOrder} />}
          />
        </form>
      )}
    </main>
  );
}
