import type { Dict } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import type { CustomerInput } from "@/db/customerQueries";

/**
 * The customer form's fields, shared by "new customer" and the customer page
 * so the two can never disagree about what a customer record holds. Defaults
 * come from the server; a saved form re-renders from the database.
 */
export function CustomerFields({
  t,
  values,
  disabled,
}: {
  t: Dict;
  values?: CustomerInput;
  disabled?: boolean;
}) {
  const field = "grid gap-0.5 text-[11px] font-semibold";
  const optional = (
    <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
  );
  return (
    <>
      <label className={field}>
        {t.company}
        <input
          type="text"
          name="company"
          required
          maxLength={REQUEST_LIMITS.companyChars}
          defaultValue={values?.company}
          disabled={disabled}
        />
      </label>
      <label className={field}>
        {t.contactName}
        <input
          type="text"
          name="contactName"
          required
          maxLength={REQUEST_LIMITS.contactNameChars}
          defaultValue={values?.contactName}
          disabled={disabled}
        />
      </label>
      <label className={field}>
        {t.phone}
        <input
          type="tel"
          name="phone"
          dir="ltr"
          required
          maxLength={REQUEST_LIMITS.phoneChars}
          defaultValue={values?.phone}
          disabled={disabled}
        />
      </label>
      <label className={field}>
        <span>
          {t.email} {optional}
        </span>
        <input
          type="email"
          name="email"
          dir="ltr"
          maxLength={REQUEST_LIMITS.emailChars}
          defaultValue={values?.email ?? ""}
          disabled={disabled}
        />
      </label>
      <label className={field}>
        <span>
          {t.city} {optional}
        </span>
        <input
          type="text"
          name="city"
          maxLength={REQUEST_LIMITS.cityChars}
          defaultValue={values?.city}
          disabled={disabled}
        />
      </label>
      <label className={`${field} sm:col-span-2`}>
        <span>
          {t.address} {optional}
        </span>
        <textarea
          name="address"
          rows={2}
          maxLength={REQUEST_LIMITS.addressChars}
          defaultValue={values?.address}
          disabled={disabled}
        />
      </label>
    </>
  );
}
