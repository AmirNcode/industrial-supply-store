import Link from "next/link";
import { submitQuoteAction } from "@/app/actions";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt, formatPrice } from "@/lib/money";
import type { CartLine } from "@/lib/cart";
import type { CustomerRow } from "@/db/customerQueries";
import QuoteSubmitButton from "@/components/QuoteSubmitButton";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

const ERROR_KEY = {
  missing: "required",
  expired: "quoteFormExpired",
  "cart-changed": "quoteCartChanged",
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
  lines,
  subtotal,
  rate,
  submissionToken,
  error,
}: {
  locale: Locale;
  customers: CustomerRow[];
  selected: CustomerRow | null;
  lines: CartLine[];
  subtotal: number;
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
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t[errorKey]}
        </p>
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
            <Field name="city" label={t.city} maxLength={REQUEST_LIMITS.cityChars} optional={t.optional} defaultValue={selected.city} />
            <Field name="country" label={t.country} maxLength={REQUEST_LIMITS.countryChars} optional={t.optional} />
            <label className="col-span-full block text-[12px]">
              <span className="mb-0.5 block font-bold">
                {t.address}{" "}
                <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
              </span>
              <input
                type="text"
                name="address"
                maxLength={REQUEST_LIMITS.addressChars}
                defaultValue={selected.address}
                className="w-full"
              />
            </label>
            <label className="col-span-full block text-[12px]">
              <span className="mb-0.5 block font-bold">
                {t.notes}{" "}
                <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
              </span>
              <textarea name="notes" rows={3} maxLength={REQUEST_LIMITS.notesChars} className="w-full" />
            </label>
          </div>

          <aside className="self-start border border-[var(--color-rule)] p-3">
            <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[13px] font-bold">
              {t.yourOrder}{" "}
              <span className="font-normal text-[var(--color-ink-muted)]">
                (<span className="tech">{formatInt(lines.length, locale)}</span> {t.itemsInOrder})
              </span>
            </h2>
            <ul className="mb-2 max-h-[260px] overflow-y-auto text-[11px]">
              {lines.map((line) => (
                <li key={line.productId} className="flex justify-between gap-2 py-0.5">
                  <span className="tech truncate">{line.partNumber}</span>
                  <span className="tech shrink-0 text-[var(--color-ink-muted)]">
                    × {formatInt(line.qty, locale)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-[var(--color-ink)] pt-1.5 text-[13px]">
              <span>{t.subtotal}</span>
              <strong className="tech">{formatPrice(subtotal, "IRR", locale, rate)}</strong>
            </div>
            <QuoteSubmitButton label={t.repPlaceOrder} />
            <Link
              href={`/${locale}/cart`}
              className="mt-2 block text-center text-[11px] text-[var(--color-ink-muted)]"
            >
              {t.continueShopping}
            </Link>
          </aside>
        </form>
      )}
    </main>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  optional,
  defaultValue,
  maxLength,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  optional?: string;
  defaultValue?: string;
  maxLength: number;
}) {
  return (
    <label className="block text-[12px]">
      <span className="mb-0.5 block font-bold">
        {label}
        {required ? (
          <span className="text-[#a3312a]"> *</span>
        ) : optional ? (
          <span className="font-normal text-[var(--color-ink-faint)]"> ({optional})</span>
        ) : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        // Email and phone are Latin-entry fields even in the Persian UI.
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
        className="w-full"
      />
    </label>
  );
}
