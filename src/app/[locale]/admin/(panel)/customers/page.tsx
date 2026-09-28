import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { listCustomersAdmin, type RepFilter } from "@/db/customerQueries";
import { listReps } from "@/db/repQueries";
import { formatPersianDate } from "@/lib/persianCalendar";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { isUuid } from "@/lib/ids";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { originLabel } from "./originLabel";

const PAGE_SIZE = 50;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function AdminCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[]; rep?: string | string[]; page?: string | string[] }>;
}) {
  const { locale } = await params;
  // The demo's admin is public, and sign-ups there were never warned that
  // their contact details would be shown to anyone (lib/demo.ts). Reps cannot
  // be created in demo mode, so the page has nothing to demonstrate there.
  if (DEMO_MODE) notFound();
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const query = await searchParams;
  const search = one(query.q).slice(0, REQUEST_LIMITS.searchChars);
  const repParam = one(query.rep);
  const filter: RepFilter =
    repParam === "none" ? "none" : isUuid(repParam) ? { repId: repParam } : "all";
  const pageNumber = Number(one(query.page));
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;

  const [{ rows, total }, reps] = await Promise.all([
    listCustomersAdmin({ search, rep: filter, page, pageSize: PAGE_SIZE }),
    listReps(),
  ]);

  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (filter !== "all") next.set("rep", filter === "none" ? "none" : filter.repId);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return `/${l}/admin/customers${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.customers}
      </h1>

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder={t.customerSearchPlaceholder}
          aria-label={t.search}
          maxLength={REQUEST_LIMITS.searchChars}
          className="search-field min-w-[220px]"
        />
        <select
          name="rep"
          defaultValue={filter === "all" ? "all" : filter === "none" ? "none" : filter.repId}
          aria-label={t.assignRep}
        >
          <option value="all">{t.allReps}</option>
          <option value="none">{t.noRep}</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {rep.active ? rep.name : `${rep.name} (${t.repStatusInactive})`}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-small">
          {t.filter}
        </button>
      </form>

      {rows.length === 0 ? (
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
                <th>{t.email}</th>
                <th>{t.assignRep}</th>
                <th>{t.commission}</th>
                <th>{t.createdOn}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id}>
                  <td className="tech" dir="ltr">
                    {customer.customerCode}
                  </td>
                  <td>
                    <Link href={`/${l}/admin/customers/${customer.id}`}>{customer.company}</Link>
                    <div className="text-[11px] text-[var(--color-ink-muted)]">
                      {originLabel(t, customer.origin, customer.originRepName)}
                    </div>
                  </td>
                  <td>{customer.contactName}</td>
                  <td className="tech" dir="ltr">
                    {customer.phone}
                  </td>
                  <td className="tech" dir="ltr">
                    {customer.email ?? "—"}
                  </td>
                  <td>{customer.repName ?? "—"}</td>
                  <td>{customer.repEarnsCommission ? t.commissionShortOn : t.commissionShortOff}</td>
                  <td>{formatPersianDate(customer.createdAt, l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || page * PAGE_SIZE < total) && (
        <nav className="mt-3 flex gap-3 text-[12px]">
          {page > 1 && <Link href={pageHref(page - 1)}>{t.pagePrevious}</Link>}
          {page * PAGE_SIZE < total && <Link href={pageHref(page + 1)}>{t.pageNext}</Link>}
        </nav>
      )}
    </>
  );
}
