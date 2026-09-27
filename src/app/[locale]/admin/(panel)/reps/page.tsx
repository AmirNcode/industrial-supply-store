import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { listReps } from "@/db/repQueries";
import { createRepAction } from "./actions";
import { RepFields } from "./RepFields";
import { ErrorBanner } from "@/components/Banners";
import { commissionPercentLabel } from "@/lib/repAccount";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

const ERROR_KEY = {
  incomplete: "required",
  username: "repUsernameInvalid",
  "username-taken": "repUsernameTaken",
  commission: "commissionInvalid",
  invalid: "invalidInput",
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
  const t = getDict(l);
  const { error } = await searchParams;
  const reps = await listReps();
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.salesReps}
      </h1>
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}

      {reps.length > 0 && (
        <table className="spec-table mb-4">
          <thead>
            <tr>
              <th>{t.repName}</th>
              <th>{t.username}</th>
              <th>{t.phone}</th>
              <th className="num">{t.commission}</th>
              <th className="num">{t.customers}</th>
              <th>{t.status}</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((rep) => (
              <tr key={rep.id}>
                <td>
                  <Link href={`/${l}/admin/reps/${rep.id}`}>{rep.name}</Link>
                </td>
                <td className="tech" dir="ltr">{rep.username}</td>
                <td className="tech" dir="ltr">{rep.phone}</td>
                <td className="num">{commissionPercentLabel(rep.commissionRateBp, l)}</td>
                <td className="num">{formatInt(rep.customerCount, l)}</td>
                <td>{rep.active ? t.repStatusActive : t.repStatusInactive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-3 text-[13px] font-bold">{t.newRep}</h2>
        <form action={createRepAction} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={l} />
          <RepFields t={t} disabled={DEMO_MODE} />
          <button type="submit" className="btn-small justify-self-start sm:col-span-2" disabled={DEMO_MODE}>
            {t.createRep}
          </button>
        </form>
      </section>
    </>
  );
}
