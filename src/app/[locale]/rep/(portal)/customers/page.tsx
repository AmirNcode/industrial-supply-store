import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { listCustomersForRep } from "@/db/customerQueries";
import { formatPersianDate, formatPersianDay, tehranToday } from "@/lib/persianCalendar";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function RepCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { q } = await searchParams;
  const search = (typeof q === "string" ? q : "").slice(0, REQUEST_LIMITS.searchChars);
  const rep = await requireRep(l);
  const customers = await listCustomersForRep(rep.id, search);
  const today = tehranToday();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{t.customers}</h1>
        <Link href={`/${l}/rep/customers/new`} className="btn-small">
          {t.newCustomer}
        </Link>
      </div>

      <form method="get" className="mb-3 flex max-w-[480px] gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder={t.customerSearchPlaceholder}
          aria-label={t.search}
          maxLength={REQUEST_LIMITS.searchChars}
          className="min-w-0 flex-1"
        />
        <button type="submit" className="btn-small">
          {t.search}
        </button>
      </form>

      {customers.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noCustomersYet}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="spec-table">
            <thead>
              <tr>
                <th>{t.customerId}</th>
                <th>{t.company}</th>
                <th>{t.contactName}</th>
                <th>{t.phone}</th>
                <th>{t.lastOrder}</th>
                <th>{t.nextFollowUp}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="tech" dir="ltr">
                    {customer.customerCode}
                  </td>
                  <td>
                    <Link href={`/${l}/rep/customers/${customer.id}`}>{customer.company}</Link>
                  </td>
                  <td>{customer.contactName}</td>
                  <td className="tech" dir="ltr">
                    {customer.phone}
                  </td>
                  <td>{customer.lastOrderAt ? formatPersianDate(customer.lastOrderAt, l) : "—"}</td>
                  <td
                    className={
                      customer.nextFollowUpOn && customer.nextFollowUpOn <= today
                        ? "font-bold text-[var(--color-danger)]"
                        : undefined
                    }
                  >
                    {customer.nextFollowUpOn ? formatPersianDay(customer.nextFollowUpOn, l) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
