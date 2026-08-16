import type { SpecDefRow } from "@/db/queries";
import type { SpecBag } from "@/db/schema";
import { pick, type Locale } from "@/lib/i18n";
import { formatSpecNumber } from "@/lib/money";
import { specValueLabel } from "@/lib/specValues";

/**
 * What a phone card leads with, when there are no column headings to read.
 *
 * Extracted from `ProductCardList` when the family page stopped rendering a
 * second copy of every row and started producing its cards from the table's own
 * markup. Both surfaces have to pick the same specs and format them the same
 * way, and two copies of this would drift the first time either was touched.
 */

export type SummaryPart = { label: string | null; value: string; ltr: boolean };

/**
 * The columns a card is allowed to lead with.
 *
 * `mobile` is the family's explicit answer and is honoured as given. Failing
 * that, `table`/filterable is the family's implicit answer to "which columns
 * identify a product", which is the same question a card asks — and it is the
 * only answer available for a family whose columns came from a supplier file,
 * where nothing is filterable until somebody says so.
 */
export function identifyingDefs(defs: readonly SpecDefRow[]): SpecDefRow[] {
  const mobile = defs.filter((d) => d.mobile);
  return mobile.length > 0
    ? mobile
    : defs.filter((d) => d.display === "table" || d.filterable);
}

/**
 * Narrow those to the ones that actually differ across the rows on the page.
 *
 * Showing the first N instead printed `Dash 004 · Width 0.07"` on six
 * consecutive cards differing only by durometer — a list of apparent
 * duplicates the buyer cannot tell apart.
 *
 * An explicit `mobile` choice is an instruction rather than a hint, so it is
 * returned untouched: a column somebody asked for is shown even where it
 * happens not to vary. Every varying spec is kept, not a truncated few — two
 * rows differing only by the spec that got dropped would render as identical
 * cards, which is worse than a summary wrapping to a third line.
 */
export function summaryDefsFor(
  defs: readonly SpecDefRow[],
  products: readonly { specs: SpecBag }[],
): SpecDefRow[] {
  const identifying = identifyingDefs(defs);
  if (defs.some((d) => d.mobile)) return identifying.slice(0, 6);

  const varying = identifying.filter((d) => {
    const seen = new Set<string>();
    for (const p of products) {
      const v = p.specs[d.key];
      if (v === null || v === undefined || v === "") continue;
      seen.add(String(v));
      if (seen.size > 1) return true;
    }
    return false;
  });

  return (varying.length > 0 ? varying : identifying).slice(0, 6);
}

/**
 * One product's summary, as parts rather than a joined string.
 *
 * Concatenating Persian labels with Latin values garbles genuinely: without
 * isolation the bidi algorithm reorders each Latin run against the surrounding
 * RTL text, so "قطر داخلی 3mm" rendered with the number detached from its
 * label. The caller wraps each value in `<bdi>`.
 */
export function summaryParts(
  specs: SpecBag,
  defs: readonly SpecDefRow[],
  locale: Locale,
): SummaryPart[] {
  const out: SummaryPart[] = [];
  for (const d of defs) {
    const raw = specs[d.key];
    if (raw === null || raw === undefined || raw === "") continue;

    if (d.kind === "number" && typeof raw === "number") {
      // `0.21"` alone is ambiguous between an ID and an OD, so dimensions keep
      // their label; material, hardness and colour name themselves, and
      // prefixing "Hardness Durometer 70A" only costs width.
      out.push({
        label: pick(d, "label", locale),
        value: `${formatSpecNumber(raw)}${d.unit}`,
        ltr: true,
      });
      continue;
    }

    const text = specValueLabel(String(raw), locale);
    out.push({ label: null, value: text, ltr: /^[\x20-\x7E]*$/.test(text) });
  }
  return out;
}
