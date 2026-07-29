import Link from "next/link";
import type { Facet, SpecDefRow, Filters } from "@/db/queries";
import { FacetList, type FacetItem } from "./FacetList";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { specValueLabel } from "@/lib/specValues";
import { toggleHref, clearAllHref, countActiveFilters, type RawSearchParams } from "@/lib/filters";
import { formatSpecNumber } from "@/lib/money";

/** Above this many values a facet gets a search box and its own scroller. */
const SEARCHABLE_AT = 14;

export function FacetSidebar({
  locale,
  base,
  searchParams,
  facets,
  defs,
  filters,
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  facets: Facet[];
  defs: SpecDefRow[];
  filters: Filters;
}) {
  const t = getDict(locale);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const active = countActiveFilters(filters);

  // Render facets in spec-table column order so the sidebar and the table agree.
  const ordered = defs
    .filter((d) => d.filterable)
    .map((d) => facets.find((f) => f.key === d.key))
    .filter((f): f is Facet => Boolean(f) && f!.values.length > 0);

  return (
    <aside className="shrink-0" style={{ width: 210 }}>
      <div className="mb-2 flex items-baseline justify-between border-b border-[var(--color-ink)] pb-1">
        <h2 className="text-[13px] font-bold">{t.filterBy}</h2>
        {active > 0 && (
          <Link href={clearAllHref(base, searchParams)} prefetch={false} scroll={false} className="text-[11px]">
            {t.clearAll}
          </Link>
        )}
      </div>

      {ordered.map((facet) => {
        const def = defByKey.get(facet.key);
        if (!def) return null;
        const selected = new Set(filters[facet.key] ?? []);

        const items: FacetItem[] = facet.values.map((v) => ({
          value: v.value,
          label:
            def.kind === "number"
              ? `${formatSpecNumber(Number(v.value))}${def.unit}`
              : specValueLabel(v.value, locale),
          href: toggleHref(base, searchParams, facet.key, v.value),
          count: v.count,
          selected: selected.has(v.value),
        }));

        const searchable = items.length > SEARCHABLE_AT;
        // A short numeric facet becomes chips — a dimension should be a target,
        // not a line of text. Longer ones stay lists, and the longest get a
        // search box above a scroller.
        const asChips = !searchable && def.kind === "number";
        const columns = !searchable && !asChips && items.length > 6 ? 2 : 1;

        return (
          <section key={facet.key} className="mb-3.5 border-b border-[var(--color-rule-light)] pb-3">
            <h3 className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink)]">{pick(def, "label", locale)}</h3>
            <FacetList
              items={items}
              searchable={searchable}
              columns={columns}
              asChips={asChips}
              searchLabel={t.search}
            />
          </section>
        );
      })}

      {ordered.length === 0 && (
        <p className="text-[11px] text-[var(--color-ink-faint)]">—</p>
      )}
    </aside>
  );
}
