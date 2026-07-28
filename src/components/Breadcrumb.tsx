import Link from "next/link";
import type { CategoryRow } from "@/db/queries";
import { pick, type Locale } from "@/lib/i18n";

/**
 * The reference site's breadcrumb doubles as the result counter, which is why
 * the product count sits at the head of the line rather than above the table.
 */
export function Breadcrumb({
  locale,
  trail,
  current,
  count,
  countLabel,
}: {
  locale: Locale;
  trail: CategoryRow[];
  current?: string;
  count?: number;
  countLabel?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-2 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-[var(--color-ink-muted)]"
    >
      {count !== undefined && (
        <>
          <span className="font-bold text-[var(--color-ink)]">
            <span className="tech">{countLabel}</span>
          </span>
          <span className="text-[var(--color-rule)]">|</span>
        </>
      )}
      {trail.map((c, i) => (
        <span key={c.id} className="flex items-baseline gap-1.5">
          {i > 0 && <span aria-hidden="true">&gt;</span>}
          <Link href={`/${locale}/c/${c.path}`} prefetch={false}>
            {pick(c, "name", locale)}
          </Link>
        </span>
      ))}
      {current && (
        <span className="flex items-baseline gap-1.5">
          {trail.length > 0 && <span aria-hidden="true">&gt;</span>}
          <span className="text-[var(--color-ink)]">{current}</span>
        </span>
      )}
    </nav>
  );
}
