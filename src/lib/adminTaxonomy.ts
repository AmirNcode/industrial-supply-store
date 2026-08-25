/**
 * Shared, browser-safe taxonomy primitives for the products workbench.
 *
 * Categories and product families use independent serial sequences, so a bare
 * numeric `?cat=12` is ambiguous as soon as both tables contain id 12. The
 * short namespaced key is the page's stable identity in URLs and client state.
 */
export type TaxonomyNodeKey = `c:${number}` | `f:${number}`;
export type TaxonomyNodeKind = "category" | "family";
export type TaxonomyVisibilityDraft = Partial<Record<TaxonomyNodeKey, boolean>>;

export type AdminTaxonomyNode = {
  key: TaxonomyNodeKey;
  kind: TaxonomyNodeKind;
  id: number;
  /** Category parent for categories; owning category for families. */
  parentId: number | null;
  depth: number;
  slug: string;
  path: string;
  sort: number;
  nameEn: string;
  nameFa: string;
  imageUrl: string;
  aboutEn: string;
  aboutFa: string;
  isVisible: boolean;
  productCount: number;
  /** Subtree count for a category; zero for a family. */
  familyCount: number;
  /** Family-only stock roll-up. */
  inventoryAvailable: number;
  inventoryOnHold: number;
  inventorySold: number;
  /** Products referenced by a past order; used by the existing delete guard. */
  orderedProducts: number;
};

export function categoryNodeKey(id: number): TaxonomyNodeKey {
  return `c:${id}`;
}

export function familyNodeKey(id: number): TaxonomyNodeKey {
  return `f:${id}`;
}

export function parseTaxonomyNodeKey(value: string | null | undefined): TaxonomyNodeKey | null {
  if (!value || !/^[cf]:[1-9]\d*$/.test(value)) return null;
  const id = Number(value.slice(2));
  return Number.isSafeInteger(id) ? (value as TaxonomyNodeKey) : null;
}

/** Display-name duplicate checks use the same normalization in UI and SQL. */
export function normalizeTaxonomyName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** Swap with one adjacent sibling; invalid/end-of-run moves are no-ops. */
export function moveSibling(
  order: readonly number[],
  id: number,
  by: -1 | 1,
): number[] {
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** A visibility click is dirty only while it differs from the stored value. */
export function setVisibilityDraft(
  draft: Readonly<TaxonomyVisibilityDraft>,
  key: TaxonomyNodeKey,
  stored: boolean,
  next: boolean,
): TaxonomyVisibilityDraft {
  const updated = { ...draft };
  if (next === stored) delete updated[key];
  else updated[key] = next;
  return updated;
}

/** Keep local relative order while accepting siblings created/deleted on refresh. */
export function reconcileSiblingOrder(
  local: readonly number[],
  server: readonly number[],
): number[] {
  const serverIds = new Set(server);
  const kept = local.filter((id) => serverIds.has(id));
  const already = new Set(kept);
  return [...kept, ...server.filter((id) => !already.has(id))];
}
