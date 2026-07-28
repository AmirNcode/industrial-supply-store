import Link from "next/link";
import type { SpecDefRow, Filters } from "@/db/queries";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { specValueLabel } from "@/lib/specValues";
import { formatSpecNumber } from "@/lib/money";
import { toggleHref, clearAllHref, type RawSearchParams } from "@/lib/filters";

/**
 * Horizontal row of active filters, each removable in one tap.
 *
 * On mobile the facet rail is behind a sheet, so without this there is no
 * on-screen evidence of what is narrowing the results — a buyer would see a
 * short list and have no idea why.
 */
export function ActiveFilterPills({
  locale,
  base,
  searchParams,
  filters,
  defs,
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  filters: Filters;
  defs: SpecDefRow[];
}) {
  const t = getDict(locale);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const entries = Object.entries(filters).flatMap(([key, values]) =>
    values.map((value) => ({ key, value })),
  );
  if (entries.length === 0) return null;

  return (
    <div className="scroll-x -mx-3 mb-2 px-3 lg:hidden">
      <div className="flex items-center gap-2 pb-1">
        {entries.map(({ key, value }) => {
          const def = defByKey.get(key);
          const label = def
            ? def.kind === "number"
              ? `${formatSpecNumber(Number(value))}${def.unit}`
              : specValueLabel(value, locale)
            : value;
          return (
            <Link
              key={`${key}-${value}`}
              href={toggleHref(base, searchParams, key, value)}
              prefetch={false}
              scroll={false}
              className="filter-pill hover:no-underline"
            >
              {def && (
                <span className="text-[var(--color-ink-muted)]">
                  {pick(def, "label", locale)}:
                </span>
              )}
              <span className="tech font-bold">{label}</span>
              <span aria-hidden="true">✕</span>
            </Link>
          );
        })}
        <Link
          href={clearAllHref(base, searchParams)}
          prefetch={false}
          scroll={false}
          className="whitespace-nowrap text-[12px] underline"
        >
          {t.clearAll}
        </Link>
      </div>
    </div>
  );
}
