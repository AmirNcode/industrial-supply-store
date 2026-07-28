import type { SpecBag } from "@/db/schema";
import type {
  FamilyGen,
  GeneratedProduct,
  GeneratedSpecDef,
} from "./types";

/**
 * Deterministic PRNG so reseeding produces an identical catalog — otherwise
 * every reset would invalidate bookmarks and screenshots during design review.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Builds the cartesian product of the axes, then thins it evenly if it exceeds
 * `cap`. Thinning by stride rather than truncation keeps the full range of every
 * axis visible in the facets — truncating would lop off all the large sizes.
 */
function cartesian(gen: FamilyGen): SpecBag[] {
  const axes = gen.axes;
  const total = axes.reduce((n, a) => n * a.values.length, 1);
  const cap = gen.cap ?? 3000;
  const stride = total > cap ? Math.ceil(total / cap) : 1;

  const out: SpecBag[] = [];
  for (let i = 0; i < total; i += stride) {
    const bag: SpecBag = {};
    let rem = i;
    for (let a = axes.length - 1; a >= 0; a--) {
      const axis = axes[a];
      const v = axis.values[rem % axis.values.length];
      rem = Math.floor(rem / axis.values.length);
      bag[axis.key] = v;
    }
    out.push(bag);
  }
  return out;
}

/** Default price heuristic: scale with the largest numeric spec present. */
function defaultScale(s: SpecBag): number {
  let biggest = 0;
  for (const v of Object.values(s)) {
    if (typeof v === "number" && v > biggest) biggest = v;
  }
  return 1 + Math.min(biggest, 60) * 0.09;
}

/**
 * Part numbers imitate the reference site's `9452K12` shape. The stem is derived
 * from the family's ordinal so it is unique across families and stable across
 * reseeds, without every family having to declare one by hand.
 */
const PN_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I and O omitted — misread as 1/0.

function partNumberPrefix(familyIndex: number): string {
  const stem = 1000 + ((familyIndex * 617) % 8999);
  const letter = PN_LETTERS[familyIndex % PN_LETTERS.length];
  return `${stem}${letter}`;
}

export function generateFamily(
  familySlug: string,
  gen: FamilyGen,
  familyIndex: number,
): { specDefs: GeneratedSpecDef[]; products: GeneratedProduct[] } {
  const prefix = partNumberPrefix(familyIndex);
  // ---- spec column definitions, axes then derived, in declared order -------
  const specDefs: GeneratedSpecDef[] = [];
  let sort = 0;
  const pushDef = (d: Omit<GeneratedSpecDef, "sort">) =>
    specDefs.push({ ...d, sort: sort++ });

  for (const axis of gen.axes) {
    pushDef({
      key: axis.key,
      labelEn: axis.labelEn,
      labelFa: axis.labelFa,
      unit: axis.unit ?? "",
      kind: axis.kind ?? (typeof axis.values[0] === "number" ? "number" : "text"),
      filterable: axis.filterable ?? true,
    });
    // Insert any derived column that asked to sit after this axis.
    for (const d of gen.derived ?? []) {
      if (d.after === axis.key) {
        pushDef({
          key: d.key,
          labelEn: d.labelEn,
          labelFa: d.labelFa,
          unit: d.unit ?? "",
          kind: d.kind ?? "number",
          filterable: d.filterable ?? false,
        });
      }
    }
  }
  for (const d of gen.derived ?? []) {
    if (!d.after) {
      pushDef({
        key: d.key,
        labelEn: d.labelEn,
        labelFa: d.labelFa,
        unit: d.unit ?? "",
        kind: d.kind ?? "number",
        filterable: d.filterable ?? false,
      });
    }
  }

  // ---- products ------------------------------------------------------------
  const rand = mulberry32(hashString(familySlug));
  const bags = cartesian(gen);
  const scale = gen.priceScale ?? defaultScale;
  const products: GeneratedProduct[] = [];

  bags.forEach((bag, i) => {
    for (const d of gen.derived ?? []) {
      const v = d.compute(bag);
      if (v !== null && v !== undefined) bag[d.key] = v;
    }

    const jitter = 0.9 + rand() * 0.25;
    const priceCents = Math.max(
      35,
      Math.round((gen.basePriceCents * scale(bag) * jitter) / 5) * 5,
    );
    // Two quantity breaks, mirroring the reference site's 1-9 / 10-Up columns.
    const bulkCents = Math.round((priceCents * 0.85) / 5) * 5;

    const packQty =
      typeof gen.packQty === "function" ? gen.packQty(bag) : (gen.packQty ?? 1);
    const leadDays =
      typeof gen.leadDays === "function" ? gen.leadDays(bag) : (gen.leadDays ?? 0);

    products.push({
      partNumber: `${prefix}${i + 1}`,
      specs: bag,
      priceCents,
      priceTiers: [
        { minQty: 1, priceCents },
        { minQty: 10, priceCents: bulkCents },
      ],
      packQty,
      leadDays,
      // A minority out of stock keeps the availability column from looking fake.
      inStock: rand() > 0.06,
      sort: i,
    });
  });

  return { specDefs, products };
}

// ---------------------------------------------------------------------------
// Shared value helpers used by the taxonomy
// ---------------------------------------------------------------------------

/** Inclusive numeric range with a fixed step, rounded to kill FP drift. */
export function range(from: number, to: number, step: number, dp = 4): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(dp)));
  return out;
}

/** Fractional-inch ladder as display strings, e.g. 1/4", 5/16". */
export function fractionalInches(sixteenths: number[]): string[] {
  return sixteenths.map((n) => {
    const g = gcd(n, 16);
    const num = n / g;
    const den = 16 / g;
    return den === 1 ? `${num}"` : `${num}/${den}"`;
  });
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
