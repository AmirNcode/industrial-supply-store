"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Facet, SpecDefRow, Filters } from "@/db/queries";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { specValueLabel } from "@/lib/specValues";
import { formatSpecNumber, formatInt } from "@/lib/money";
import {
  toggleHref,
  clearAllHref,
  countActiveFilters,
  type RawSearchParams,
} from "@/lib/filters";

/**
 * Sticky filter bar plus full-height sheet, replacing the desktop facet rail on
 * phones.
 *
 * Facet values render as chips rather than the desktop's link lists: at 375px a
 * dense list of 229 inside diameters is impossible to hit reliably, and three
 * columns of tappable chips is both scannable and thumb-safe. Selections are
 * still plain links, so filtering works with the sheet open and the URL stays
 * the single source of truth.
 */
export function MobileFilterBar({
  locale,
  base,
  searchParams,
  facets,
  defs,
  filters,
  total,
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  facets: Facet[];
  defs: SpecDefRow[];
  filters: Filters;
  total: number;
}) {
  const t = getDict(locale);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const active = countActiveFilters(filters);

  // The sheet stays open across filter taps so a buyer can narrow several specs
  // in one pass, but must close when they navigate away entirely.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const ordered = defs
    .filter((d) => d.filterable)
    .map((d) => facets.find((f) => f.key === d.key))
    .filter((f): f is Facet => Boolean(f) && f!.values.length > 0);

  return (
    <div className="lg:hidden">
      {/*
        Fixed, not sticky. `position: sticky` can only travel inside its own
        containing block, and this wrapper is exactly as tall as the bar — so
        sticky had zero range and the bar simply sat at the end of the page.
        The page reserves space for it with padding instead.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-rule)] bg-white px-3 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 text-start"
        >
          <span>
            <span className="block text-[15px] font-bold uppercase tracking-wide text-[var(--color-pine)]">
              {t.filterBy}
            </span>
            <span className="block text-[12px] text-[var(--color-ink-muted)]">
              {active > 0
                ? `${formatInt(active, locale)} ${active === 1 ? t.filterApplied : t.filtersApplied}`
                : t.noFiltersApplied}
            </span>
          </span>
          <span className="text-[15px] font-bold text-[var(--color-pine)]">
            <span className="tech">{formatInt(total, locale)}</span> {t.products}
          </span>
        </button>
      </div>

      {open && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={t.filterBy}>
          <div className="flex items-start justify-between border-b border-[var(--color-rule)] px-4 py-3">
            <div>
              <h2 className="text-[17px] font-bold uppercase tracking-wide text-[var(--color-pine)]">
                {t.filterBy}
              </h2>
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                {active > 0
                  ? `${formatInt(active, locale)} ${active === 1 ? t.filterApplied : t.filtersApplied}`
                  : t.noFiltersApplied}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {active > 0 && (
                <Link
                  href={clearAllHref(base, searchParams)}
                  prefetch={false}
                  scroll={false}
                  className="text-[13px]"
                >
                  {t.clearAll}
                </Link>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.done}
                className="text-[22px] leading-none text-[var(--color-ink-muted)]"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="sheet-body px-4 pb-24">
            {ordered.map((facet) => {
              const def = defByKey.get(facet.key)!;
              const selected = new Set(filters[facet.key] ?? []);
              return (
                <section
                  key={facet.key}
                  className="border-b border-[var(--color-rule-light)] py-4"
                >
                  <h3 className="mb-2 text-[15px] font-bold">
                    {pick(def, "label", locale)}
                  </h3>
                  <ul className="grid grid-cols-3 gap-2">
                    {facet.values.map((v) => {
                      const label =
                        def.kind === "number"
                          ? `${formatSpecNumber(Number(v.value))}${def.unit}`
                          : specValueLabel(v.value, locale);
                      const isOn = selected.has(v.value);
                      return (
                        <li key={v.value}>
                          <Link
                            href={toggleHref(base, searchParams, facet.key, v.value)}
                            prefetch={false}
                            scroll={false}
                            data-selected={isOn}
                            className="chip hover:no-underline"
                          >
                            <span className="tech">{label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {ordered.length === 0 && (
              <p className="py-6 text-[13px] text-[var(--color-ink-faint)]">—</p>
            )}
          </div>

          <div className="border-t border-[var(--color-rule)] bg-white p-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-primary w-full py-3 text-[15px]"
            >
              {t.viewProducts} <span className="tech">{formatInt(total, locale)}</span>{" "}
              {t.products}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
