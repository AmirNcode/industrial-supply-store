import type { Filters } from "@/db/queries";

/**
 * Filter params carry an `f_` prefix so a spec key can never collide with a
 * reserved param (`q`, `pn`) — spec keys come from seed data and are not a
 * namespace we fully control.
 *
 * The helpers below still drop `page`. The family table is no longer paginated,
 * so nothing writes it, but a link bookmarked while it was carries it and there
 * is no reason to propagate it into every facet href from then on.
 */
export const FILTER_PREFIX = "f_";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseFilters(sp: RawSearchParams): Filters {
  const out: Filters = {};
  for (const [rawKey, rawVal] of Object.entries(sp)) {
    if (!rawKey.startsWith(FILTER_PREFIX)) continue;
    const key = rawKey.slice(FILTER_PREFIX.length);
    if (!key) continue;
    const values = Array.isArray(rawVal) ? rawVal : rawVal ? [rawVal] : [];
    if (values.length > 0) out[key] = values;
  }
  return out;
}

function toParams(sp: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  return params;
}

/** Href with one facet value toggled on or off, resetting to page 1. */
export function toggleHref(
  base: string,
  sp: RawSearchParams,
  key: string,
  value: string,
): string {
  const params = toParams(sp);
  const name = FILTER_PREFIX + key;
  const current = params.getAll(name);
  params.delete(name);
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  for (const v of next) params.append(name, v);
  params.delete("page");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href with every value of one spec removed. */
export function clearKeyHref(base: string, sp: RawSearchParams, key: string): string {
  const params = toParams(sp);
  params.delete(FILTER_PREFIX + key);
  params.delete("page");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href with all filters removed but non-filter params (like `pn`) preserved. */
export function clearAllHref(base: string, sp: RawSearchParams): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith(FILTER_PREFIX) || k === "page") continue;
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function countActiveFilters(filters: Filters): number {
  return Object.values(filters).reduce((n, v) => n + v.length, 0);
}
