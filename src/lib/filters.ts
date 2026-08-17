import type { Filters } from "@/db/queries";
import { REQUEST_LIMITS, boundedString } from "./requestLimits";

/**
 * Filter params carry an `f_` prefix so a spec key can never collide with a
 * reserved param (`q`, `pn`, `rows`, `view`) — spec keys come from seed data
 * and are not a namespace we fully control.
 */
export const FILTER_PREFIX = "f_";

const FAMILY_WINDOW_PARAMS = ["page", "rows", "view"] as const;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseFilters(sp: RawSearchParams): Filters {
  const out: Filters = {};
  let keys = 0;
  let totalValues = 0;
  for (const [rawKey, rawVal] of Object.entries(sp)) {
    if (!rawKey.startsWith(FILTER_PREFIX)) continue;
    const key = rawKey.slice(FILTER_PREFIX.length);
    if (
      !key ||
      key.length > REQUEST_LIMITS.filterKeyChars ||
      !/^[a-z0-9_]+$/i.test(key) ||
      keys >= REQUEST_LIMITS.filterKeys ||
      totalValues >= REQUEST_LIMITS.filterValuesTotal
    ) {
      continue;
    }
    const submitted = Array.isArray(rawVal) ? rawVal : rawVal ? [rawVal] : [];
    const remaining = REQUEST_LIMITS.filterValuesTotal - totalValues;
    const values = [...new Set(submitted)]
      .filter((value) => value.length > 0 && value.length <= REQUEST_LIMITS.filterValueChars)
      .slice(0, Math.min(REQUEST_LIMITS.filterValuesPerKey, remaining));
    if (values.length > 0) out[key] = values;
    if (values.length > 0) {
      keys += 1;
      totalValues += values.length;
    }
  }
  return out;
}

function toParams(sp: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(parseFilters(sp))) {
    for (const value of values) params.append(FILTER_PREFIX + key, value);
  }
  const pinned = boundedString(sp.pn, 120);
  if (pinned) params.set("pn", pinned);
  return params;
}

function validFilterPair(key: string, value: string): boolean {
  return (
    key.length > 0 &&
    key.length <= REQUEST_LIMITS.filterKeyChars &&
    /^[a-z0-9_]+$/i.test(key) &&
    value.length > 0 &&
    value.length <= REQUEST_LIMITS.filterValueChars
  );
}

function resetFamilyWindow(params: URLSearchParams) {
  for (const key of FAMILY_WINDOW_PARAMS) params.delete(key);
}

/** Href with one facet value toggled on or off, resetting to page 1. */
export function toggleHref(
  base: string,
  sp: RawSearchParams,
  key: string,
  value: string,
): string {
  const params = toParams(sp);
  if (!validFilterPair(key, value)) {
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
  const name = FILTER_PREFIX + key;
  const current = params.getAll(name);
  params.delete(name);
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  for (const v of next) params.append(name, v);
  resetFamilyWindow(params);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href with every value of one spec removed. */
export function clearKeyHref(base: string, sp: RawSearchParams, key: string): string {
  const params = toParams(sp);
  params.delete(FILTER_PREFIX + key);
  resetFamilyWindow(params);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href with all filters removed but non-filter params (like `pn`) preserved. */
export function clearAllHref(base: string, sp: RawSearchParams): string {
  const params = new URLSearchParams();
  const pinned = boundedString(sp.pn, 120);
  if (pinned) params.set("pn", pinned);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Preserve the current filters while changing only the visible family window. */
export function familyWindowHref(
  base: string,
  sp: RawSearchParams,
  window: number | "all" | null,
): string {
  const params = toParams(sp);
  resetFamilyWindow(params);
  if (window === "all") params.set("view", "all");
  else if (window !== null) params.set("rows", String(window));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function countActiveFilters(filters: Filters): number {
  return Object.values(filters).reduce((n, v) => n + v.length, 0);
}
