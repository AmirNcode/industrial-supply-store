import { getDict, type Locale } from "@/lib/i18n";
import { STATUS_LABEL_KEY } from "./OrderStatusPill";
import type { OrderStatus } from "@/lib/orders";

/** The happy path, in order. `cancelled` is not a step — it ends the trail. */
const STEPS = ["received", "invoiced", "preparing", "shipped", "delivered"] as const;

export type TimelineStamps = {
  createdAt: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

/** Latin digits, as every other identifier here — a date is matched, not read aloud. */
function day(value: string | null): string | null {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

export function OrderTimeline({
  locale,
  status,
  stamps,
}: {
  locale: Locale;
  status: OrderStatus;
  stamps: TimelineStamps;
}) {
  const t = getDict(locale);
  const at: Record<(typeof STEPS)[number], string | null> = {
    received: day(stamps.createdAt),
    invoiced: day(stamps.invoicedAt),
    preparing: day(stamps.paidAt),
    shipped: day(stamps.shippedAt),
    delivered: day(stamps.deliveredAt),
  };

  const cancelled = status === "cancelled";
  // A cancelled order shows how far it actually got and then stops. Rendering
  // the remaining steps greyed out would suggest they are still coming.
  const reachedCount = cancelled
    ? STEPS.filter((s) => at[s] !== null).length
    : STEPS.indexOf(status as (typeof STEPS)[number]) + 1;
  const visible = cancelled ? STEPS.slice(0, Math.max(reachedCount, 1)) : STEPS;

  return (
    <ol className="mb-4 grid gap-2">
      {visible.map((step, i) => {
        const reached = i < reachedCount;
        return (
          <li key={step} className="flex items-baseline gap-2.5 text-[12px]">
            <span
              aria-hidden="true"
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                reached ? "bg-[var(--color-navy)]" : "bg-[var(--color-rule)]"
              }`}
            />
            <span className={reached ? "font-semibold" : "text-[var(--color-ink-faint)]"}>
              {t[STATUS_LABEL_KEY[step]]}
            </span>
            {at[step] && (
              <span className="tech ms-auto text-[11px] text-[var(--color-ink-muted)]">
                {at[step]}
              </span>
            )}
          </li>
        );
      })}

      {cancelled && (
        <li className="flex items-baseline gap-2.5 text-[12px]">
          <span
            aria-hidden="true"
            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-danger)]"
          />
          <span className="font-semibold text-[var(--color-danger)]">
            {t.statusCancelled}
          </span>
        </li>
      )}
    </ol>
  );
}
