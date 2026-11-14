import { getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { ConfirmSubmit } from "./ConfirmSubmit";

/**
 * The customer's own cancel, on the account order page and the pay link. A
 * confirmation step because it cannot be undone from the customer's side:
 * the held stock is released at once and may be bought by someone else.
 * The caller decides whether to show it (`customerCanCancel`); the action
 * checks again, in the database.
 */
export function CancelOrderForm({
  locale,
  action,
  hidden = {},
}: {
  locale: Locale;
  action: (formData: FormData) => Promise<void>;
  hidden?: Record<string, string>;
}) {
  const t = getDict(locale);
  return (
    <details className="mb-4 text-[12px]">
      <summary className="w-fit cursor-pointer text-[var(--color-ink-muted)]">{t.customerCancelOrder}</summary>
      <form action={action} className="mt-2 grid max-w-[480px] gap-2 border border-[var(--color-rule)] p-3">
        <input type="hidden" name="locale" value={locale} />
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <p className="text-[var(--color-ink-muted)]">{t.cancelOrderNote}</p>
        <label className="block">
          <span className="mb-0.5 block font-bold">{t.cancelReasonLabel}</span>
          <textarea name="reason" rows={2} maxLength={REQUEST_LIMITS.cancelReasonChars} dir="auto" className="w-full" />
        </label>
        <ConfirmSubmit
          label={t.customerCancelOrder}
          title={t.cancelOrderTitle}
          continueLabel={t.cancelOrderConfirm}
          discardLabel={t.cancelOrderKeep}
          echo={[{ name: "reason", label: t.cancelReasonLabel }]}
          className="btn-small w-fit"
        />
      </form>
    </details>
  );
}
