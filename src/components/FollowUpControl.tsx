import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { formatPersianDay } from "@/lib/persianCalendar";
import { FOLLOW_UP_DAYS } from "@/lib/repAccount";

/**
 * The next date to contact a customer, set in whole days from today rather
 * than picked on a calendar: a Gregorian date input would be the wrong
 * calendar for a Persian-speaking rep, and "call back in a week" is how the
 * decision is actually made. Dates are `YYYY-MM-DD` on Tehran's calendar, so
 * plain string comparison orders them.
 */
export function FollowUpControl({
  locale,
  current,
  today,
  action,
  hidden,
  disabled,
}: {
  locale: Locale;
  current: string | null;
  today: string;
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  disabled?: boolean;
}) {
  const t = getDict(locale);
  return (
    <section id="follow-up" className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 text-[13px] font-bold">{t.followUp}</h2>
      <p className="mb-2 text-[12px]">
        {current === null ? (
          t.followUpNone
        ) : current < today ? (
          <span className="font-bold text-[var(--color-danger)]">
            {formatPersianDay(current, locale)} — {t.overdue}
          </span>
        ) : current === today ? (
          <span className="font-bold">
            {formatPersianDay(current, locale)} — {t.followUpDueToday}
          </span>
        ) : (
          formatPersianDay(current, locale)
        )}
      </p>
      <form action={action} className="flex flex-wrap gap-2">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {FOLLOW_UP_DAYS.map((n) => (
          <button
            key={n}
            type="submit"
            name="days"
            value={String(n)}
            className="btn-small"
            disabled={disabled}
          >
            {n === 1 ? t.followUpTomorrow : t.followUpIn.replace("{n}", formatInt(n, locale))}
          </button>
        ))}
        {current !== null && (
          <button type="submit" name="days" value="clear" className="btn-small" disabled={disabled}>
            {t.followUpClear}
          </button>
        )}
      </form>
    </section>
  );
}
