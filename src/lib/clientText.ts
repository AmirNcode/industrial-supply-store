import type { Dict } from "./i18n";

/**
 * The wording each browser component needs, by name.
 *
 * A browser component that calls `getDict` drags both languages' full text —
 * about 38 KB compressed — into every visitor's first page load, to show a
 * handful of words (review R-8). Instead the server page that renders the
 * component picks just these keys with `textFor` and passes them as the `t`
 * prop, so the component still reads `t.search` and only those words travel.
 *
 * The import above is type-only and is erased from the bundle. Adding a word
 * to a component means adding its key to the list here; the compiler then
 * points at every `t.` that is missing.
 */
type Keys = readonly (keyof Dict)[];
export type TextFor<K extends Keys> = Pick<Dict, K[number]>;

export function textFor<K extends Keys>(dict: Dict, keys: K): TextFor<K> {
  const out: Partial<Dict> = {};
  for (const key of keys) (out as Record<string, unknown>)[key] = dict[key];
  return out as TextFor<K>;
}

export const SEARCH_BAR_TEXT = ["search", "searchPlaceholder"] as const satisfies Keys;
export const MOBILE_HEADER_TEXT = [
  ...SEARCH_BAR_TEXT,
  "catalog",
  "account",
  "brand",
  "tagline",
  "order",
  "browseCatalog",
] as const satisfies Keys;
export const ADD_TO_CART_TEXT = ["addToOrder", "pkg", "qty"] as const satisfies Keys;
export const IN_CART_TEXT = ["inCart", "remove"] as const satisfies Keys;
export const VIEW_AS_TEXT = ["viewAs", "viewAsCategories", "viewAsList"] as const satisfies Keys;
export const MOBILE_FILTER_TEXT = [
  "filterBy",
  "filterApplied",
  "filtersApplied",
  "noFiltersApplied",
  "products",
  "clearAll",
  "done",
  "viewProducts",
] as const satisfies Keys;
export const PRINT_BUTTON_TEXT = ["invoiceDownload"] as const satisfies Keys;
export const QUICK_ORDER_TEXT = [
  "quickOrderPlaceholder",
  "quickOrder",
  "addAllToOrder",
  "yourOrder",
  "requestTooLarge",
  "cartFull",
  "rateLimited",
  "added",
  "notFound",
] as const satisfies Keys;
export const PROOF_UPLOAD_TEXT = [
  "proofEmpty",
  "proofTooLarge",
  "proofBadType",
  "proofClosed",
  "proofFull",
  "proofFailed",
  "proofRateLimited",
  "proofUploaded",
  "proofUploading",
  "proofUploadAnother",
  "proofUpload",
] as const satisfies Keys;
