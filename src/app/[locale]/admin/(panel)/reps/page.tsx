import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { listReps } from "@/db/repQueries";
import { createRepAction } from "./actions";
import { RepFields } from "./RepFields";
import { ErrorBanner } from "@/components/Banners";
import { commissionPercentLabel } from "@/lib/repAccount";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatInt, formatRial } from "@/lib/money";
import { listAllTargets, listRecentDeliveries, listRepTotals } from "@/db/repMoney";
import { persianYearMonth } from "@/lib/persianCalendar";
import { targetFor } from "@/lib/repStats";
import { GroupedAmountInput } from "@/components/GroupedAmountInput";
import { ShareButton } from "@/components/ShareButton";
import { siteOrigin } from "@/lib/siteOrigin";

const ERROR_KEY = {
  incomplete: "required",
  username: "repUsernameInvalid",
  "username-taken": "repUsernameTaken",
  commission: "commissionInvalid",
  invalid: "invalidInput",
  amount: "amountInvalid",
} as const;

export default async function AdminRepsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  await requireAdmin(l);
  const t = getDict(l);
  const { error } = await searchParams;
  const [reps, totals, recent, targets, origin] = await Promise.all([
    listReps(),
    listRepTotals(),
    // Forty days always covers the current Persian month; the rows are placed
    // in months here, because Postgres has no Persian calendar.
    listRecentDeliveries(40),
    listAllTargets(),
    siteOrigin(),
  ]);
  // The same address the credential hand-over message gives a new rep.
  const repSignInUrl = `${origin}/${l}/rep/signin`;
  const current = persianYearMonth(new Date());
  const thisMonth = new Map<string, number>();
  for (const row of recent) {
    const ym = persianYearMonth(row.deliveredAt);
    if (ym.year === current.year && ym.month === current.month) {
      thisMonth.set(row.repId, (thisMonth.get(row.repId) ?? 0) + row.salesRial);
    }
  }
  const percent = (value: number) => `${formatInt(value, l)}${l === "fa" ? "٪" : "%"}`;
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.salesReps}
      </h1>
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}

      {reps.length > 0 && (
        <div className="mb-4 overflow-x-auto">
        <table className="spec-table">
          <thead>
            <tr>
              <th>{t.repName}</th>
              <th>{t.username}</th>
              <th>{t.phone}</th>
              <th className="num">{t.commission}</th>
              <th className="num">{t.customers}</th>
              <th className="num">{t.repThisMonth}</th>
              <th className="num">{t.monthlyTarget}</th>
              <th className="num">{t.earned}</th>
              <th className="num">{t.paidOut}</th>
              <th className="num">{t.owed}</th>
              <th>{t.status}</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((rep) => {
              const sales = thisMonth.get(rep.id) ?? 0;
              const target = targetFor(targets.get(rep.id) ?? [], current);
              const earned = totals.get(rep.id)?.earnedRial ?? 0;
              const paid = totals.get(rep.id)?.paidRial ?? 0;
              return (
              <tr key={rep.id}>
                <td>
                  <Link href={`/${l}/admin/reps/${rep.id}`}>{rep.name}</Link>
                </td>
                <td className="tech" dir="ltr">{rep.username}</td>
                <td className="tech" dir="ltr">{rep.phone}</td>
                <td className="num">{commissionPercentLabel(rep.commissionRateBp, l)}</td>
                <td className="num">{formatInt(rep.customerCount, l)}</td>
                <td className="num tech">{formatRial(sales, l)}</td>
                <td className="num tech">
                  {target === null || target === 0
                    ? "—"
                    : `${formatRial(target, l)} · ${percent(Math.round((sales / target) * 100))}`}
                </td>
                <td className="num tech">{formatRial(earned, l)}</td>
                <td className="num tech">{formatRial(paid, l)}</td>
                <td className="num tech">{formatRial(earned - paid, l)}</td>
                <td>{rep.active ? t.repStatusActive : t.repStatusInactive}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-3 text-[13px] font-bold">{t.newRep}</h2>
        <div className="mb-3 max-w-[680px] border border-[var(--color-rule)] bg-[var(--color-navy-tint)] p-2 text-[12px]">
          <p className="mb-1 font-bold">{t.repSignInPage}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="tech min-w-0 break-all" dir="ltr" data-testid="rep-signin-url">
              {repSignInUrl}
            </code>
            <ShareButton text={repSignInUrl} label={t.copy} copiedLabel={t.copied} copyOnly />
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.repSignInPageNote}</p>
        </div>
        <form action={createRepAction} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={l} />
          <RepFields t={t} disabled={DEMO_MODE} />
          <label className="grid gap-0.5 text-[11px] font-semibold">
            {t.monthlyTargetOptional}
            <GroupedAmountInput name="target" maxLength={24} disabled={DEMO_MODE} />
          </label>
          <button type="submit" className="btn-small justify-self-start sm:col-span-2" disabled={DEMO_MODE}>
            {t.createRep}
          </button>
        </form>
      </section>
    </>
  );
}
