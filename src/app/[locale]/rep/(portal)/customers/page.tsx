import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import {
  REP_CUSTOMER_PAGE_SIZE,
  REP_SEARCH_MIN_CHARS,
  listCustomersForRep,
  searchBeyondMine,
} from "@/db/customerQueries";
import { startOrderAction } from "../../actions";
import { RepSearchResults } from "@/components/RepSearchResults";
import { ErrorBanner } from "@/components/Banners";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { salesByCustomerForRep } from "@/db/repMoney";
import { formatInt, formatRial } from "@/lib/money";
import { formatPersianDate, formatPersianDay, tehranToday } from "@/lib/persianCalendar";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function RepCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { q, page: pageParam, error } = await searchParams;
  const search = (typeof q === "string" ? q : "").slice(0, REQUEST_LIMITS.searchChars);
  const pageNumber = typeof pageParam === "string" ? Number(pageParam) : 1;
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10_000 ? pageNumber : 1;
  const rep = await requireRep(l);
  const longEnough = search.trim().length >= REP_SEARCH_MIN_CHARS;
  // Page 1 only: paging through the rep's own list must not re-run the wide
  // search or spend a rate-limit token, or flipping pages alone trips the limit.
  const wide = longEnough && page === 1;
  const tooShort = search.trim().length > 0 && !longEnough;
  // The wider search reaches customers nobody looks after, so it is bounded
  // per rep; a rep over the limit still gets their own list.
  const limited = wide
    ? !(await consumeRateLimit("rep:customer-search", RATE_LIMITS.repCustomerSearch, { accountId: rep.id })).allowed
    : false;
  const [{ rows: customers, total }, sales, beyond] = await Promise.all([
    listCustomersForRep(rep.id, search, page),
    salesByCustomerForRep(rep.id),
    wide && !limited ? searchBeyondMine(rep.id, search) : Promise.resolve({ unassigned: [], taken: [] }),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / REP_CUSTOMER_PAGE_SIZE));
  const pageHref = (n: number) =>
    `/${l}/rep/customers?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
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
          placeholder={t.repSearchCustomers}
          aria-label={t.repSearchCustomers}
          maxLength={REQUEST_LIMITS.searchChars}
          className="search-field min-w-0 flex-1"
        />
        <button type="submit" className="btn-small">
          {t.search}
        </button>
      </form>

      {error === "customer" && <ErrorBanner>{t.customerNotYours}</ErrorBanner>}
      {tooShort && <p className="mb-2 text-[12px] text-[var(--color-ink-muted)]">{t.repSearchTooShort}</p>}
      {limited && <ErrorBanner>{t.rateLimited}</ErrorBanner>}

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

      {lastPage > 1 && (
        <nav className="mt-3 flex items-center gap-4 text-[12px]" aria-label={t.customers}>
          {page > 1 ? <Link href={pageHref(page - 1)}>{t.pagePrevious}</Link> : <span />}
          <span className="text-[var(--color-ink-muted)]">
            {formatInt(page, l)} / {formatInt(lastPage, l)}
          </span>
          {page < lastPage ? <Link href={pageHref(page + 1)}>{t.pageNext}</Link> : <span />}
        </nav>
      )}

      <div className="mt-4">
        <RepSearchResults
          locale={l}
          unassigned={beyond.unassigned}
          taken={beyond.taken}
          action={(customer) => (
            <form action={startOrderAction}>
              <input type="hidden" name="locale" value={l} />
              <input type="hidden" name="customerId" value={customer.id} />
              <button type="submit" className="btn-small">
                {t.newOrder}
              </button>
            </form>
          )}
        />
      </div>
    </>
  );
}
