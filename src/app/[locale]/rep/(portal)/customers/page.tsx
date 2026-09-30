import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { listCustomersForRep } from "@/db/customerQueries";
import { salesByCustomerForRep } from "@/db/repMoney";
import { formatRial } from "@/lib/money";
import { formatPersianDate, formatPersianDay, tehranToday } from "@/lib/persianCalendar";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

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
  const [customers, sales] = await Promise.all([
    listCustomersForRep(rep.id, search),
    salesByCustomerForRep(rep.id),
  ]);
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
          className="search-field min-w-0 flex-1"
        />
        <button type="submit" className="btn-small">
          {t.search}
        </button>
      </form>

      {customers.length > 0 && customers[0].totalCount > customers.length && (
        <p className="mb-2 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.listTruncated
            .replace("{shown}", formatInt(customers.length, l))
            .replace("{total}", formatInt(customers[0].totalCount, l))}
        </p>
      )}
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
                <th className="num">{t.sales}</th>
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
                  <td className="num tech tech-num">{formatRial(sales.get(customer.id) ?? 0, l)}</td>
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
