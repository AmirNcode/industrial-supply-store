import Link from "next/link";
import type { Facet, SpecDefRow, Filters } from "@/db/queries";
import { FacetList, type FacetItem } from "./FacetList";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { specValueLabel } from "@/lib/specValues";
import {
  toggleHref,
  clearAllHref,
  countActiveFilters,
  type RawSearchParams,
} from "@/lib/filters";
import { formatSpecNumber, formatInt } from "@/lib/money";

/** Above this many values a facet gets a search box and its own scroller. */
const SEARCHABLE_AT = 14;

/**
 * The desktop facet rail: a panel beside the table rather than a fold above it.
 *
 * The fold this replaces was chosen to buy back 210px of table width. A rail
 * costs that width on every page whether or not anyone is filtering — but a
 * fold is read once and closed, so the value counts it carries are stale the
 * moment they matter, and re-opening it pushes the results off the screen the
 * reader is checking them against. The rail is read *while* the results move,
 * which is what those counts are for.
 *
 * The width objection is answered rather than dismissed: `collapsed` shrinks
 * this to a 44px edge, and the family page starts it collapsed when the table
 * has enough columns to want the room back. The toggle is a checkbox and
 * `:has()` — the same mechanism the expandable rows use, so a panel that is
 * entirely server-rendered stays that way.
 *
 * Phones get `MobileFilterBar` instead; a rail and a bottom sheet would be two
 * answers to one question.
 */
export function FacetSidebar({
  locale,
  base,
  searchParams,
  facets,
  defs,
  filters,
  collapsed = false,
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  facets: Facet[];
  defs: SpecDefRow[];
  filters: Filters;
  /** Start folded to the 44px edge. Set for families with a wide table. */
  collapsed?: boolean;
}) {
  const t = getDict(locale);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const active = countActiveFilters(filters);

  // Render facets in spec-table column order so the rail and the table agree.
  const ordered = defs
    .filter((d) => d.filterable)
    .map((d) => facets.find((f) => f.key === d.key))
    .filter((f): f is Facet => Boolean(f) && f!.values.length > 0);

  if (ordered.length === 0) return null;

  const applied = Object.entries(filters).flatMap(([key, values]) =>
    values.map((value) => ({ key, value })),
  );

  return (
    <aside className="catalog-rail hidden lg:block" aria-label={t.filterBy}>
      {/* Off-screen rather than removed, so the rail folds from the keyboard. */}
      <input
        type="checkbox"
        id="catalog-rail"
        className="rail-toggle"
        defaultChecked={collapsed}
      />
      <div className="rail-bar">
        <label className="rail-head" htmlFor="catalog-rail">
          <span>{t.filterBy}</span>
          {active > 0 && (
            <span className="rail-count">{formatInt(active, locale)}</span>
          )}
          <span className="rail-caret" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <path
                d="m12 4-5 6 5 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
        {active > 0 && (
          <Link
            href={clearAllHref(base, searchParams)}
            prefetch={false}
            scroll={false}
            className="rail-clear"
          >
            {t.clearAll}
          </Link>
        )}
      </div>

      {/* What is currently narrowing the table, removable one at a time. The
          page-wide pill row is gone: a filter belongs beside the control that
          set it, not above the results it removed. */}
      {applied.length > 0 && (
        <div className="rail-chips">
          {applied.map(({ key, value }) => {
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
                className="rail-chip hover:no-underline"
              >
                {def && <span>{pick(def, "label", locale)}</span>}
                <span className="tech font-semibold">{label}</span>
                <span className="text-[var(--color-ink-muted)]" aria-hidden="true">
                  ✕
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="rail-groups">
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
          // A short numeric facet becomes chips — a dimension should be a
          // target, not a line of text. Longer ones stay lists, and the longest
          // get a search box above a scroller.
          const asChips = !searchable && def.kind === "number";

          return (
            <section key={facet.key} className="rail-group">
              <h3 className="rail-label">
                <span>{pick(def, "label", locale)}</span>
                {/* The unit belongs to the column, not to each of its 229
                    values; saying it once here is what lets the list stay bare
                    numbers a reader can scan down. */}
                {def.kind === "number" && def.unit && (
                  <span className="rail-unit">{def.unit}</span>
                )}
              </h3>
              <div className="mt-2">
                <FacetList
                  items={items}
                  searchable={searchable}
                  // One column: the rail is 216px inside its padding, and two
                  // columns of dimensions there wrap mid-number.
                  columns={1}
                  asChips={asChips}
                  showCounts
                  searchLabel={t.search}
                />
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
