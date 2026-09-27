import type { Dict } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/**
 * The rep form's fields, shared by "new rep" and "edit rep" so the two can
 * never disagree about what a rep is. Defaults come from the server: nothing
 * here holds state, so a saved form re-renders from the database.
 */
export function RepFields({
  t,
  disabled,
  values,
}: {
  t: Dict;
  disabled: boolean;
  values?: { name: string; username: string; phone: string; email: string; commission: string };
}) {
  const field = "grid gap-0.5 text-[11px] font-semibold";
  return (
    <>
      <label className={field}>
        {t.repName}
        <input type="text" name="name" required maxLength={REQUEST_LIMITS.contactNameChars} defaultValue={values?.name} disabled={disabled} />
      </label>
      <label className={field}>
        {t.username}
        <input
          type="text"
          name="username"
          dir="ltr"
          required
          maxLength={32}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={values?.username}
          disabled={disabled}
        />
        <span className="font-normal text-[var(--color-ink-muted)]">{t.repUsernameHint}</span>
      </label>
      <label className={field}>
        {t.phone}
        <input type="tel" name="phone" dir="ltr" maxLength={REQUEST_LIMITS.phoneChars} defaultValue={values?.phone} disabled={disabled} />
      </label>
      <label className={field}>
        <span>
          {t.email} <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
        </span>
        <input type="email" name="email" dir="ltr" maxLength={REQUEST_LIMITS.emailChars} defaultValue={values?.email} disabled={disabled} />
      </label>
      <label className={field}>
        {t.commissionPercent}
        <input
          type="text"
          name="commission"
          dir="ltr"
          inputMode="decimal"
          placeholder="2.5"
          required
          maxLength={8}
          defaultValue={values?.commission}
          disabled={disabled}
        />
      </label>
    </>
  );
}
