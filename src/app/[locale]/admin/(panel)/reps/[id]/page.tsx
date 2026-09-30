import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getRepById, listActiveReps } from "@/db/repQueries";
import {
  addPayoutAction,
  deactivateRepAction,
  voidPayoutAction,
  reactivateRepAction,
  resetRepPasswordAction,
  setTargetAction,
  updateRepAction,
} from "../actions";
import { loadRepSummary } from "@/lib/repDashboard";
import { listInProgressForRep, listPayouts } from "@/db/repMoney";
import { getFxRate } from "@/lib/fx";
import { formatRial } from "@/lib/money";
import { persianMonthLabel, persianYearMonth } from "@/lib/persianCalendar";
import { RepDashboard } from "@/components/RepDashboard";
import { CommissionReport } from "@/components/CommissionReport";
import { RepFields } from "../RepFields";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ShownOnceCredential } from "@/components/ShownOnceCredential";
import { readShownOnce } from "@/lib/shownOnce";
import { siteOrigin } from "@/lib/siteOrigin";
import { formatCommissionPercent } from "@/lib/repAccount";
import { isUuid } from "@/lib/ids";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

const ERROR_KEY = {
  incomplete: "required",
  username: "repUsernameInvalid",
  "username-taken": "repUsernameTaken",
  commission: "commissionInvalid",
  invalid: "invalidInput",
  destination: "repBadDestination",
  amount: "amountInvalid",
} as const;

const OK_KEY = {
  saved: "repSaved",
  deactivated: "repDeactivated",
  reactivated: "repReactivated",
  payout: "payoutSaved",
  "payout-voided": "payoutVoided",
  target: "targetSaved",
} as const;

export default async function AdminRepPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; year?: string | string[] }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isUuid(id)) notFound();
  const l = locale as Locale;
  await requireAdmin(l);
  const t = getDict(l);
  const { ok, error, year: yearParam } = await searchParams;
  const year = typeof yearParam === "string" ? Number(yearParam) : NaN;
  const tableYear = Number.isInteger(year) && year >= 1300 && year <= 1600 ? year : undefined;

  const rep = await getRepById(id);
  if (!rep) notFound();
  const liveRate = await getFxRate();
  const [activeReps, origin, credential, summary, payouts, inProgress] = await Promise.all([
    listActiveReps(),
    siteOrigin(),
    ok === "created" || ok === "password" ? readShownOnce("rep", id) : Promise.resolve(null),
    loadRepSummary(id, tableYear),
    listPayouts(id),
    listInProgressForRep(id, liveRate),
  ]);
  const current = persianYearMonth(new Date());
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;
  const okKey = ok && ok in OK_KEY ? OK_KEY[ok as keyof typeof OK_KEY] : null;
  const section = "mb-4 border border-[var(--color-rule)] p-3";

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/admin/reps`}>← {t.salesReps}</Link>
      </p>
      <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{rep.name}</h1>
        <span className="tech text-[12px]" dir="ltr">{rep.username}</span>
        <span className="text-[11px] text-[var(--color-ink-muted)]">
          {rep.active ? t.repStatusActive : t.repStatusInactive}
        </span>
        {!DEMO_MODE && (
          <Link href={`/${l}/admin/customers?rep=${rep.id}`} className="text-[12px]">
            {t.customers}
          </Link>
        )}
      </div>

      {credential && (
        <ShownOnceCredential
          heading={t.tempPasswordOnce}
          loginLabel={t.username}
          login={credential.login}
          password={credential.password}
          message={t.repCredentialsMessage
            .replace("{url}", `${origin}/${l}/rep/signin`)
            .replace("{login}", credential.login)
            .replace("{password}", credential.password)}
          labels={{ tempPassword: t.tempPassword, share: t.share, copied: t.copied }}
        />
      )}
      {okKey && <SuccessBanner>{t[okKey]}</SuccessBanner>}
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}

      <section className={section}>
        <h2 className="mb-3 text-[13px] font-bold">{t.details}</h2>
        <form action={updateRepAction} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="repId" value={rep.id} />
          <RepFields
            t={t}
            disabled={DEMO_MODE}
            values={{
              name: rep.name,
              username: rep.username,
              phone: rep.phone,
              email: rep.email,
              commission: formatCommissionPercent(rep.commissionRateBp),
            }}
          />
          <button type="submit" className="btn-small justify-self-start sm:col-span-2" disabled={DEMO_MODE}>
            {t.save}
          </button>
        </form>
      </section>

      <RepDashboard
        locale={l}
        summary={summary}
        yearHref={(y) => `/${l}/admin/reps/${id}?year=${y}`}
      />

      <section id="payouts" className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.payouts}</h2>
        <form action={addPayoutAction} className="mb-3 grid max-w-[680px] gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="repId" value={rep.id} />
          <label className="grid gap-0.5 text-[11px] font-semibold">
            {t.payoutAmount}
            <input type="text" name="amount" dir="ltr" inputMode="numeric" required maxLength={24} disabled={DEMO_MODE} />
          </label>
          <label className="grid gap-0.5 text-[11px] font-semibold">
            {t.note}
            <input type="text" name="note" maxLength={500} disabled={DEMO_MODE} />
          </label>
          <button type="submit" className="btn-small justify-self-start" disabled={DEMO_MODE}>
            {t.recordPayout}
          </button>
        </form>
      </section>
      <CommissionReport
        locale={l}
        summary={summary}
        payouts={payouts}
        inProgress={inProgress}
        deleteAction={
          DEMO_MODE
            ? undefined
            : {
                action: voidPayoutAction,
                hidden: { locale: l, repId: rep.id },
                labels: {
                  delete: t.voidPayout,
                  confirm: t.confirmVoidPayout,
                  continue: t.confirmContinue,
                  discard: t.confirmDiscard,
                },
              }
        }
      />

      <section id="target" className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.monthlyTarget}</h2>
        <p className="mb-2 text-[12px]">
          {summary.targetThisMonth === null || summary.targetThisMonth === 0
            ? t.noTargetSet
            : formatRial(summary.targetThisMonth, l)}
        </p>
        <form action={setTargetAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="repId" value={rep.id} />
          <input
            type="text"
            name="target"
            dir="ltr"
            inputMode="numeric"
            required
            maxLength={24}
            aria-label={t.monthlyTarget}
            disabled={DEMO_MODE}
          />
          <button type="submit" className="btn-small" disabled={DEMO_MODE}>
            {t.setTarget}
          </button>
        </form>
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          {t.targetFromThisMonth.replace("{month}", persianMonthLabel(current, l))}
        </p>
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.password}</h2>
        <form action={resetRepPasswordAction}>
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="repId" value={rep.id} />
          <ConfirmSubmit
            label={t.issueTempPassword}
            title={t.confirmIssueTempPassword}
            continueLabel={t.confirmContinue}
            discardLabel={t.confirmDiscard}
            disabled={DEMO_MODE}
            details={[{ label: t.username, value: rep.username, tech: true }]}
          />
        </form>
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.status}</h2>
        {rep.active ? (
          <form action={deactivateRepAction} className="grid max-w-[680px] gap-2">
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="repId" value={rep.id} />
            <p className="text-[11px] text-[var(--color-ink-muted)]">{t.repDeactivateHint}</p>
            <label className="grid gap-0.5 text-[11px] font-semibold">
              {t.repMoveCustomersTo}
              <select name="destination" defaultValue="" disabled={DEMO_MODE}>
                <option value="">{t.noRep}</option>
                {activeReps
                  .filter((other) => other.id !== rep.id)
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
              </select>
            </label>
            <ConfirmSubmit
              label={t.repDeactivate}
              title={t.confirmDeactivateRep}
              continueLabel={t.confirmContinue}
              discardLabel={t.confirmDiscard}
              disabled={DEMO_MODE}
              details={[{ label: t.repName, value: rep.name }]}
              className="btn-small justify-self-start"
            />
          </form>
        ) : (
          <form action={reactivateRepAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="repId" value={rep.id} />
            <button type="submit" className="btn-small" disabled={DEMO_MODE}>
              {t.repReactivate}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
