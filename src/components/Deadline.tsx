import { getDict, type Locale } from "@/lib/i18n";
import { fillMessage } from "@/lib/fillMessage";
import { formatDeadline } from "@/lib/orderFlow";
import { formatInt } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders";

const LABEL_KEY = {
  received: "quoteDueBy",
  quoted: "quoteValidUntil",
  invoiced: "payDeadline",
} as const;

const HOUR = 3_600_000;

/**
 * The page's clock, read once and handed to every Deadline on it. A function
 * rather than `Date.now()` in the page body, which the purity lint rightly
 * flags inside a component: all countdowns on a page must agree.
 */
export function deadlineNow(): number {
  return Date.now();
}

/**
 * An open order's deadline and what is left of it.
 *
 * Rendered on the server from the same `now` the page was built with, so the
 * text is right with scripts off and never differs between server and browser.
 * It is not a live ticker: the page is rebuilt on every visit anyway, and the
 * deadline itself is enforced by the sweep, not by what this shows. Under 48
 * hours the remainder is hours and minutes, since "1 d 20 h" hides how close
 * a 24-hour pay window is to closing.
 */
export function Deadline({
  locale,
  status,
  expiresAt,
  now,
  compact = false,
}: {
  locale: Locale;
  status: OrderStatus;
  expiresAt: string | null;
  /** Epoch milliseconds from `deadlineNow()`; one value for every Deadline on a page. */
  now: number;
  /** One quiet line for a list row, rather than the page's prominent block. */
  compact?: boolean;
}) {
  if (expiresAt === null || !(status in LABEL_KEY)) return null;
  const t = getDict(locale);
  const label = fillMessage(t[LABEL_KEY[status as keyof typeof LABEL_KEY]], {
    time: formatDeadline(expiresAt, locale),
  });

  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const hours = Math.floor(left / HOUR);
  const remaining =
    left < 48 * HOUR
      ? fillMessage(t.countdownHoursMinutes, {
          h: formatInt(hours, locale),
          m: formatInt(Math.floor((left % HOUR) / 60_000), locale),
        })
      : fillMessage(t.countdownDaysHours, {
          d: formatInt(Math.floor(hours / 24), locale),
          h: formatInt(hours % 24, locale),
        });
  const timeLeft = fillMessage(t.timeLeft, { time: remaining });

  if (compact) {
    return (
      <span className="text-[var(--color-ink-muted)]">
        {label} · {timeLeft}
      </span>
    );
  }
  return (
    <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[13px]">
      <strong>{label}</strong> · {timeLeft}
    </p>
  );
}
