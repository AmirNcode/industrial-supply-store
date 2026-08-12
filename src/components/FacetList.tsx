"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type FacetItem = {
  value: string;
  label: string;
  href: string;
  count: number;
  selected: boolean;
};

/**
 * A long facet (229 O-ring inside diameters) is unusable as a flat list, so
 * above a threshold it gains a filter box and a fixed-height scroller — the
 * same affordance the reference site uses on its dimension facets.
 */
export function FacetList({
  items,
  searchable,
  columns = 1,
  asChips = false,
  searchLabel,
}: {
  items: FacetItem[];
  searchable: boolean;
  columns?: number;
  /** Render values as tappable chips rather than a text list. */
  asChips?: boolean;
  searchLabel: string;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(needle));
  }, [items, q]);

  return (
    <div>
      {searchable && (
        <div className="mb-1 flex items-center border border-[var(--color-control-border)] bg-white">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="min-w-0 flex-1 border-0 px-1.5 py-1 text-[12px] outline-none"
          />
          <span className="px-1.5 text-[var(--color-ink-faint)]" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="M13 13l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </div>
      )}

      {/* Short numeric facets render as chips so a dimension is a target, not a
          line of text; long ones stay a scrolling list, which is the only shape
          that works for 229 inside diameters. */}
      {asChips ? (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((i) => (
            <li key={i.value}>
              <Link
                href={i.href}
                prefetch={false}
                scroll={false}
                data-selected={i.selected}
                className="facet-chip tech"
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          className={
            searchable
              ? "max-h-[170px] overflow-y-auto rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-panel-alt)] px-1.5 py-1"
              : ""
          }
          style={columns > 1 ? { columnCount: columns, columnGap: "0.75rem" } : undefined}
        >
          {shown.map((i) => (
            <li key={i.value} className="break-inside-avoid">
              <Link
                href={i.href}
                prefetch={false}
                scroll={false}
                className={`block py-[1px] text-[12px] leading-snug ${
                  i.selected ? "font-semibold text-[var(--color-navy-deep)]" : ""
                }`}
              >
                <span className="tech">{i.label}</span>
                {i.selected && <span aria-hidden="true"> ✕</span>}
              </Link>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="py-1 text-[11px] text-[var(--color-ink-faint)]">—</li>
          )}
        </ul>
      )}
    </div>
  );
}
