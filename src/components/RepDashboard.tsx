import Link from "next/link";
import type { ReactNode } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt, formatRial } from "@/lib/money";
import { persianMonthName } from "@/lib/persianCalendar";
import type { RepSummary } from "@/lib/repStats";

const faYear = new Intl.NumberFormat("fa-IR", { useGrouping: false });

/** A Persian year reads without a thousands separator: ۱۴۰۵, not ۱٬۴۰۵. */
function formatYear(year: number, locale: Locale): string {
  return locale === "fa" ? faYear.format(year) : String(year);
}

function formatPercent(value: number, locale: Locale): string {
  return `${formatInt(value, locale)}${locale === "fa" ? "٪" : "%"}`;
}

function Tile({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="border border-[var(--color-rule)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="tech text-[15px] font-bold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 text-[13px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A rep's numbers on their home page. Everything counts delivered orders only,
 * placed in the Persian month they were delivered in (lib/repStats.ts), and
 * every amount is in rial: reps never see dollar amounts.
 */
export function RepDashboard({
  locale,
  summary,
  yearHref,
}: {
  locale: Locale;
  summary: RepSummary;
  yearHref: (year: number) => string;
}) {
  const t = getDict(locale);
  const rial = (value: number) => formatRial(value, locale);
  const target = summary.targetThisMonth;
  const percent = summary.percentOfTargetThisMonth ?? 0;

  return (
    <>
      <div className="mb-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Tile label={t.salesToDate} value={rial(summary.salesToDate)} testId="tile-sales-to-date" />
        <Tile label={t.salesThisMonth} value={rial(summary.salesThisMonth)} />
        <Tile label={t.salesThisYear} value={rial(summary.salesThisYear)} />
        <Tile label={t.customers} value={formatInt(summary.customerCount, locale)} />
        <Tile
          label={t.averagePerCustomer}
          value={
            summary.averagePerBuyingCustomer === null ? "—" : rial(summary.averagePerBuyingCustomer)
          }
        />
        <Tile label={t.commissionOwed} value={rial(summary.owedRial)} testId="tile-commission-owed" />
      </div>

      <Section title={t.monthlyTarget}>
        {/* A target of zero is how a target is removed, so it reads as none. */}
        {target === null || target === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noTargetSet}</p>
        ) : (
          <>
            <div
              role="progressbar"
              aria-label={t.monthlyTarget}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, percent)}
              className="h-3 w-full max-w-[480px] border border-[var(--color-rule)]"
            >
              <div
                className="h-full bg-[var(--color-navy)]"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
            <p className="mt-1 text-[12px]">
              {t.targetProgress
                .replace("{percent}", formatPercent(percent, locale))
                .replace("{target}", rial(target))}
            </p>
          </>
        )}
      </Section>

      <Section
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>
              {t.salesByMonth} {formatYear(summary.tableYear, locale)}
            </span>
            {summary.availableYears
              .filter((year) => year !== summary.tableYear)
              .map((year) => (
                <Link key={year} href={yearHref(year)} className="text-[12px] font-normal">
                  {formatYear(year, locale)}
                </Link>
              ))}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="spec-table">
            <thead>
              <tr>
                <th>{t.month}</th>
                <th className="num">{t.sales}</th>
                <th className="num">{t.saleCount}</th>
                <th className="num">{t.commission}</th>
                <th className="num">{t.target}</th>
                <th className="num">{t.ofTarget}</th>
              </tr>
            </thead>
            <tbody>
              {summary.months.map((line) => (
                <tr key={line.month}>
                  <td>{persianMonthName(line.month, locale)}</td>
                  <td className="num tech tech-num">{rial(line.salesRial)}</td>
                  <td className="num tech tech-num">{formatInt(line.saleCount, locale)}</td>
                  <td className="num tech tech-num">{rial(line.commissionRial)}</td>
                  <td className="num tech tech-num">
                    {line.targetRial === null ? "—" : rial(line.targetRial)}
                  </td>
                  <td className="num tech tech-num">
                    {line.percentOfTarget === null ? "—" : formatPercent(line.percentOfTarget, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.years.length > 0 && (
          <>
            <h3 className="mt-3 mb-1 text-[12px] font-bold">{t.yearTotals}</h3>
            <div className="overflow-x-auto">
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>{t.year}</th>
                    <th className="num">{t.sales}</th>
                    <th className="num">{t.saleCount}</th>
                    <th className="num">{t.commission}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.years.map((line) => (
                    <tr key={line.year}>
                      <td className="tech">{formatYear(line.year, locale)}</td>
                      <td className="num tech tech-num">{rial(line.salesRial)}</td>
                      <td className="num tech tech-num">{formatInt(line.saleCount, locale)}</td>
                      <td className="num tech tech-num">{rial(line.commissionRial)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title={t.topCustomers}>
        {summary.salesToDate === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noSalesYet}</p>
        ) : (
          <ol
            className={`grid gap-0.5 ps-5 text-[12px] ${locale === "fa" ? "[list-style-type:persian]" : "list-decimal"}`}
            data-testid="top-customers"
          >
            {summary.topCustomers.map((customer) => (
              <li key={customer.customerKey}>
                {customer.company} — <span className="tech">{rial(customer.salesRial)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
