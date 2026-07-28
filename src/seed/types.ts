import type { SpecBag, PriceTier } from "@/db/schema";

/** One filterable/displayable dimension of a product family. */
export type Axis = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit?: string;
  kind?: "number" | "text";
  filterable?: boolean;
  values: (string | number)[];
};

/** A column that is computed from the axes rather than enumerated. */
export type DerivedDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit?: string;
  kind?: "number" | "text";
  filterable?: boolean;
  /** Where it sits among the axis columns. */
  after?: string;
  compute: (s: SpecBag) => string | number | null;
};

export type FamilyGen = {
  axes: Axis[];
  derived?: DerivedDef[];
  /** Unit price at qty 1, USD cents, before per-spec scaling. */
  basePriceCents: number;
  /** Multiplies base price from the spec bag. Defaults to a size heuristic. */
  priceScale?: (s: SpecBag) => number;
  packQty?: number | ((s: SpecBag) => number);
  leadDays?: number | ((s: SpecBag) => number);
  /** Hard cap on generated SKUs; the cartesian product is truncated evenly. */
  cap?: number;
};

export type FamilySeed = {
  slug: string;
  en: string;
  fa: string;
  descEn: string;
  descFa: string;
  aboutEn?: string;
  aboutFa?: string;
  groupEn?: string;
  groupFa?: string;
  icon?: string;
  gen: FamilyGen;
};

export type CategorySeed = {
  slug: string;
  en: string;
  fa: string;
  icon?: string;
  children?: CategorySeed[];
  families?: FamilySeed[];
};

export type GeneratedProduct = {
  partNumber: string;
  specs: SpecBag;
  priceCents: number;
  priceTiers: PriceTier[];
  packQty: number;
  leadDays: number;
  inStock: boolean;
  sort: number;
};

export type GeneratedSpecDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  sort: number;
};
