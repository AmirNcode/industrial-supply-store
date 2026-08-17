import type { RawSearchParams } from "./filters";

/** Keep the first family document small enough to render and hydrate quickly. */
export const FAMILY_INITIAL_ROWS = 100;

/** Each progressive request adds one buyer-scannable tranche. */
export const FAMILY_ROW_STEP = 100;

/** Larger documents require the deliberately named all-products mode. */
export const FAMILY_MAX_PROGRESSIVE_ROWS = 500;

export type FamilyWindow =
  | { showAll: true; rows: null }
  | { showAll: false; rows: number };

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse only the two catalog-window parameters this route owns.
 *
 * Normalising to fixed steps prevents arbitrary query strings from creating a
 * new server-rendered document size (and cache key) for every integer. Invalid,
 * repeated, fractional, and non-finite values all fall back to the safe first
 * tranche.
 */
export function parseFamilyWindow(sp: RawSearchParams): FamilyWindow {
  if (single(sp.view) === "all") return { showAll: true, rows: null };

  const raw = single(sp.rows);
  if (!raw || !/^\d+$/.test(raw)) {
    return { showAll: false, rows: FAMILY_INITIAL_ROWS };
  }

  const requested = Number(raw);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return { showAll: false, rows: FAMILY_INITIAL_ROWS };
  }

  const stepped = Math.ceil(requested / FAMILY_ROW_STEP) * FAMILY_ROW_STEP;
  return {
    showAll: false,
    rows: Math.min(
      FAMILY_MAX_PROGRESSIVE_ROWS,
      Math.max(FAMILY_INITIAL_ROWS, stepped),
    ),
  };
}

/** The next bounded tranche, or null when only explicit view-all remains. */
export function nextFamilyRows(current: number, total: number): number | null {
  if (current >= total || current >= FAMILY_MAX_PROGRESSIVE_ROWS) return null;
  return Math.min(current + FAMILY_ROW_STEP, FAMILY_MAX_PROGRESSIVE_ROWS);
}
