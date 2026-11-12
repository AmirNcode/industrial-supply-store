import Link from "next/link";
import { submitQuoteAction } from "@/app/actions";
import { getDict, type Locale } from "@/lib/i18n";
import type { CartSplit } from "@/lib/checkoutSplit";
import type { CustomerRow, OrderableCustomer, TakenCustomer, UnassignedCustomer } from "@/db/customerQueries";
import type { SavedAddress } from "@/db/addressQueries";
import { RepSearchResults } from "@/components/RepSearchResults";
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
 * Checkout as a rep sees it: first which customer the order is for, found by
 * search (name, phone or customer ID), then that customer's details,
 * prefilled and editable for this one order. Choosing is a plain GET, so it
 * works before any JavaScript and the choice is in the URL; the order itself
 * posts to the same action as every checkout, which re-checks the customer.
 * An unassigned customer shows only what is needed to order — contact, phone
 * and saved delivery addresses, never email, history or notes — and a
 * customer who is someone else's shows a refusal and no form. Money is always
 * in rial: reps never see dollar amounts.
 */
export function RepQuoteForm({
  locale,
  target,
  error,
  search,
  searchTooShort,
  searchLimited,
  mine,
  beyond,
  savedAddresses,
  split,
  parts,
  canIssue,
  vatRateBp,
  rate,
  submissionToken,
}: {
  locale: Locale;
  target: OrderableCustomer | null;
  error?: string;
  search: string;
  searchTooShort: boolean;
  searchLimited: boolean;
  mine: CustomerRow[];
  beyond: { unassigned: UnassignedCustomer[]; taken: TakenCustomer[] };
  savedAddresses: SavedAddress[];
  split: CartSplit;
  parts: Record<number, string>;
  canIssue: boolean;
  vatRateBp: number | null;
  rate: number;
  submissionToken: string;
}) {
  const t = getDict(locale);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;
  const choose = (id: string) => (
    <Link href={`/${locale}/quote?for=${id}`} className="btn-small">
      {t.useCustomer}
    </Link>
  );
  const orderable = target && target.kind !== "taken" ? target : null;

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3">
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.repOrderForCustomer}
      </h1>

      {errorKey && <ErrorNote>{t[errorKey]}</ErrorNote>}

      <form method="get" className="mb-3 flex max-w-[480px] gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder={t.repSearchCustomers}
          aria-label={t.repSearchCustomers}
          maxLength={REQUEST_LIMITS.searchChars}
          className="search-field min-w-0 flex-1"
        />
        <button type="submit" className="btn-small">
          {t.search}
        </button>
      </form>
      {searchTooShort && <p className="mb-2 text-[12px] text-[var(--color-ink-muted)]">{t.repSearchTooShort}</p>}
      {searchLimited && <ErrorNote>{t.rateLimited}</ErrorNote>}

      {mine.length > 0 && (
        <ul className="mb-4 grid gap-2 text-[12px]" data-testid="rep-search-mine">
          {mine.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-rule)] pb-2"
            >
              <strong>{customer.company}</strong>
              <span>{customer.contactName}</span>
              <span className="tech text-[var(--color-ink-muted)]" dir="ltr">
                {customer.customerCode}
              </span>
              <span className="ms-auto">{choose(customer.id)}</span>
            </li>
          ))}
        </ul>
      )}
      <RepSearchResults
        locale={locale}
        unassigned={beyond.unassigned}
        taken={beyond.taken}
        action={(customer) => choose(customer.id)}
      />

      {target?.kind === "taken" && (
        <p className="mb-4 border border-[var(--color-rule)] px-3 py-2 text-[13px]" data-testid="rep-order-taken">
          {t.repOrderTaken.replace("{name}", target.assignedTo)}
        </p>
      )}

      {orderable && (
        <form action={submitQuoteAction} className="grid gap-4 md:grid-cols-[1fr_300px]">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="submissionToken" value={submissionToken} />
          <input type="hidden" name="forCustomerId" value={orderable.customer.id} />

          {orderable.kind === "unassigned" && (
            <p className="col-span-full border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]" data-testid="rep-order-unassigned">
              {t.repOrderUnassignedNote}
            </p>
          )}

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] self-start">
            <Field name="company" label={t.company} maxLength={REQUEST_LIMITS.companyChars} required defaultValue={orderable.customer.company} />
            <Field name="contactName" label={t.contactName} maxLength={REQUEST_LIMITS.contactNameChars} required defaultValue={orderable.customer.contactName} />
            {/* An unassigned customer's email is never sent to the page. */}
            {orderable.kind === "mine" && (
              <Field name="email" label={t.email} type="email" maxLength={REQUEST_LIMITS.emailChars} optional={t.optional} defaultValue={orderable.customer.email ?? ""} />
            )}
            <Field name="phone" label={t.phone} type="tel" maxLength={REQUEST_LIMITS.phoneChars} required defaultValue={orderable.customer.phone} />
            {orderable.kind === "mine" && (
              <Field name="poNumber" label={t.poNumber} maxLength={REQUEST_LIMITS.poNumberChars} optional={t.optional} defaultValue={orderable.customer.defaultPoNumber} />
            )}
            <DeliveryFields
              locale={locale}
              defaults={orderable.kind === "mine" ? { address: orderable.customer.address, city: orderable.customer.city } : undefined}
              saved={orderable.kind === "unassigned" ? savedAddresses : []}
            />
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
