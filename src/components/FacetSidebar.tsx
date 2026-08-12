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
  layout = "rail",
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  facets: Facet[];
  defs: SpecDefRow[];
  filters: Filters;
  /**
   * `rail` is the fixed-width column beside a table. `band` is the full-width
   * fold above one, where the facets sit side by side instead of stacked — a
   * rail costs 210px of table width on every page whether or not anyone is
   * filtering, and the tables are wide enough that the trade stopped paying.
   */
  layout?: "rail" | "band";
}) {
  const t = getDict(locale);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const active = countActiveFilters(filters);

  // Render facets in spec-table column order so the sidebar and the table agree.
  const ordered = defs
    .filter((d) => d.filterable)
    .map((d) => facets.find((f) => f.key === d.key))
    .filter((f): f is Facet => Boolean(f) && f!.values.length > 0);

  const band = layout === "band";

  return (
    <aside className={band ? "w-full" : "shrink-0"} style={band ? undefined : { width: 210 }}>
      {/* In a band the fold's own summary already says "Filter by", so only the
          clear-all link is worth repeating. */}
      <div
        className={
          band
            ? "mb-2 flex justify-end"
            : "mb-2 flex items-baseline justify-between border-b border-[var(--color-ink)] pb-1"
        }
      >
        {!band && <h2 className="text-[13px] font-bold">{t.filterBy}</h2>}
        {active > 0 && (
          <Link href={clearAllHref(base, searchParams)} prefetch={false} scroll={false} className="text-[11px]">
            {t.clearAll}
          </Link>
        )}
      </div>

      <div className={band ? "grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : ""}>
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

      </div>

      {ordered.length === 0 && (
        <p className="text-[11px] text-[var(--color-ink-faint)]">—</p>
      )}
    </aside>
  );
}
