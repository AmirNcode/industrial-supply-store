import type { ReactNode } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import type { TakenCustomer, UnassignedCustomer } from "@/db/customerQueries";

/**
 * What a rep's customer search finds beyond their own list: customers nobody
 * looks after (enough to start an order) and customers who are someone
 * else's. A taken customer is one plain line with no link, no button and no
 * id — the query does not return one, so there is nothing to put in the page.
 * The customers page and the order form share it; `action` is what each does
 * with an unassigned row.
 */
export function RepSearchResults({
  locale,
  unassigned,
  taken,
  action,
}: {
  locale: Locale;
  unassigned: UnassignedCustomer[];
  taken: TakenCustomer[];
  action: (customer: UnassignedCustomer) => ReactNode;
}) {
  const t = getDict(locale);
  if (unassigned.length === 0 && taken.length === 0) return null;
  return (
    <section className="mb-4" aria-labelledby="rep-other-customers">
      <h2 id="rep-other-customers" className="mb-2 border-b border-[var(--color-rule)] pb-0.5 text-[13px] font-bold">
        {t.repOtherCustomers}
      </h2>
      <ul className="grid gap-2 text-[12px]" data-testid="rep-search-beyond">
        {unassigned.map((customer) => (
          <li
            key={customer.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-rule)] pb-2"
            data-testid="rep-search-unassigned"
          >
            <strong>{customer.company}</strong>
            <span>{customer.contactName}</span>
            <span className="tech" dir="ltr">
              {customer.phone}
            </span>
            <span className="tech text-[var(--color-ink-muted)]" dir="ltr">
              {customer.customerCode}
            </span>
            <span className="border border-[var(--color-rule)] px-1.5 text-[11px]">{t.repUnassigned}</span>
            <span className="ms-auto">{action(customer)}</span>
          </li>
        ))}
        {taken.map((customer) => (
          <li
            key={customer.customerCode}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-rule)] pb-2 text-[var(--color-ink-muted)]"
            data-testid="rep-search-taken"
          >
            <span>{customer.company}</span>
            <span className="tech" dir="ltr">
              {customer.customerCode}
            </span>
            <span>{t.repAssignedTo.replace("{name}", customer.assignedTo)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
