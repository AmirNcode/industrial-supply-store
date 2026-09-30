import { getDict, type Locale } from "@/lib/i18n";
import { formatRial } from "@/lib/money";
import { formatPersianDate, persianMonthLabel } from "@/lib/persianCalendar";
import type { RepSummary } from "@/lib/repStats";
import type { InProgressRow, Payout } from "@/db/repMoney";
import { OrderStatusPill } from "./OrderStatusPill";
import { ConfirmSubmit } from "./ConfirmSubmit";

/**
 * What a rep has earned, been paid and is owed — the same report on the rep's
 * commission page and the admin's rep page, where each payout can also be
 * removed if it was recorded by mistake. Earned counts delivered orders only;
 * orders still in progress are listed apart, with the commission they are
 * expected to bring, marked as an estimate until the order is invoiced.
 */
export function CommissionReport({
  locale,
  summary,
  payouts,
  inProgress,
  deleteAction,
}: {
  locale: Locale;
  summary: RepSummary;
  payouts: Payout[];
  inProgress: InProgressRow[];
  deleteAction?: {
    action: (formData: FormData) => Promise<void>;
    hidden: Record<string, string>;
    labels: { delete: string; confirm: string; continue: string; discard: string };
  };
}) {
  const t = getDict(locale);
  const rial = (value: number) => formatRial(value, locale);
  const section = "mb-4 border border-[var(--color-rule)] p-3";

  return (
    <>
      <div className="mb-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {[
          { label: t.earned, value: summary.earnedRial, testId: "commission-earned" },
          { label: t.paidOut, value: summary.paidRial, testId: "commission-paid" },
          { label: t.owed, value: summary.owedRial, testId: "commission-owed" },
        ].map((tile) => (
          <div key={tile.label} className="border border-[var(--color-rule)] px-3 py-2">
            <div className="text-[11px] text-[var(--color-ink-muted)]">{tile.label}</div>
            <div className="tech text-[15px] font-bold" data-testid={tile.testId}>
              {rial(tile.value)}
            </div>
          </div>
        ))}
      </div>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.earnedByMonth}</h2>
        {summary.earnedByMonth.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noSalesYet}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.month}</th>
                  <th className="num">{t.sales}</th>
                  <th className="num">{t.commission}</th>
                </tr>
              </thead>
              <tbody>
                {summary.earnedByMonth.map((line) => (
                  <tr key={`${line.ym.year}-${line.ym.month}`}>
                    <td>{persianMonthLabel(line.ym, locale)}</td>
                    <td className="num tech tech-num">{rial(line.salesRial)}</td>
                    <td className="num tech tech-num">{rial(line.commissionRial)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.payouts}</h2>
        {payouts.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noPayoutsYet}</p>
        ) : (
          <ul className="grid gap-1.5 text-[12px]" data-testid="payouts">
            {payouts.map((payout) => (
              <li
                key={payout.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${payout.voidedAt ? "text-[var(--color-ink-muted)]" : ""}`}
              >
                <span className="text-[var(--color-ink-muted)]">
                  {formatPersianDate(payout.createdAt, locale)}
                </span>
                <span className={`tech font-bold ${payout.voidedAt ? "line-through" : ""}`}>
                  {rial(payout.amountRial)}
                </span>
                {payout.note && <span>{payout.note}</span>}
                {payout.voidedAt && (
                  <span className="border border-[var(--color-rule)] px-1.5 text-[11px]">
                    {t.payoutVoidedLabel}
                  </span>
                )}
                {deleteAction && !payout.voidedAt && (
                  <form action={deleteAction.action} className="ms-auto">
                    {Object.entries(deleteAction.hidden).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <input type="hidden" name="payoutId" value={payout.id} />
                    <ConfirmSubmit
                      label={deleteAction.labels.delete}
                      title={deleteAction.labels.confirm}
                      continueLabel={deleteAction.labels.continue}
                      discardLabel={deleteAction.labels.discard}
                      details={[{ label: t.paidOut, value: rial(payout.amountRial), tech: true }]}
                      className="text-[11px] underline"
                    />
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.inProgress}</h2>
        {inProgress.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noOrdersYet}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.reference}</th>
                  <th>{t.company}</th>
                  <th>{t.status}</th>
                  <th className="num">{t.expectedCommission}</th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((order) => (
                  <tr key={order.ref}>
                    <td className="tech" dir="ltr">
                      {order.ref}
                    </td>
                    <td>{order.company}</td>
                    <td>
                      <OrderStatusPill locale={locale} status={order.status} />
                    </td>
                    <td className="num tech tech-num">
                      {rial(order.commissionRial)}
                      {order.estimate && ` (${t.estimateShort})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
