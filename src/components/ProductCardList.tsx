import Link from "next/link";
import type { ProductRow, SpecDefRow } from "@/db/queries";
import type { ProductDocument } from "@/db/schema";
import { AddToCartRow } from "./AddToCartRow";
import { InCartQty } from "./InCartQty";
import { ProductIcon } from "./ProductIcon";
import { ProductDetails } from "./ProductDetails";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { formatPrice, formatSpecNumber, formatInt, isPriceOnRequest } from "@/lib/money";
import { specValueLabel } from "@/lib/specValues";

type Item = ProductRow & {
  familyId?: number;
  familySlug?: string;
  familyEn?: string;
  familyFa?: string;
  icon?: string;
  /** Present on a family page, where the card can expand. */
  imageUrl?: string;
  documents?: ProductDocument[];
};

/**
 * The phone view of a product run.
 *
 * A 14-column spec table cannot be made usable at 375px — shrinking it just
 * produces a sideways-scrolling grid nobody reads. The reference app switches
 * to cards that lead with the identifying specs and put price and ADD where the
 * thumb is, which is what this reproduces.
 */
export function ProductCardList({
  locale,
  products,
  defs,
  defsByFamily,
  familyName,
  familyIcon,
  rate,
}: {
  locale: Locale;
  products: Item[];
  /** Column definitions for a single-family list. */
  defs?: SpecDefRow[];
  /** Per-family definitions for a mixed list spanning several families. */
  defsByFamily?: Map<number, SpecDefRow[]>;
  /** Set on a family page, where the name is already the page heading. */
  familyName?: string;
  familyIcon?: string;
  /** Toman per USD, resolved once by the page. */
  rate: number;
}) {
  const t = getDict(locale);
  const inFamily = Boolean(familyName);

  /**
   * The columns a card is allowed to lead with.
   *
   * `table` is the family's own answer to "which columns identify a product",
   * which is exactly the question a card asks — and it is the only answer
   * available for a family whose columns came from a supplier file, where
   * nothing is filterable until someone says so.
   */
  const mobileDefs = (defs ?? []).filter((d) => d.mobile);
  const identifying =
    mobileDefs.length > 0
      ? mobileDefs
      : (defs ?? []).filter((d) => d.display === "table" || d.filterable);

  /**
   * Summarise the specs that actually differ across the visible rows.
   *
   * Showing the first N columns instead would print "Dash 004 · Width 0.07"" on
   * six consecutive cards that differ only by durometer — the buyer sees a list
   * of apparent duplicates and cannot tell the parts apart.
   */
  // An explicit mobile choice is an instruction, not a hint: show exactly those
  // and do not drop the ones that happen not to vary on this page.
  const varying = mobileDefs.length > 0 ? [] : identifying.filter((d) => {
    const seen = new Set<string>();
    for (const p of products) {
      const v = p.specs[d.key];
      if (v === null || v === undefined || v === "") continue;
      seen.add(String(v));
      if (seen.size > 1) return true;
    }
    return false;
  });

  /**
   * Every varying spec is shown, not a truncated few: two rows that differ only
   * by the spec we dropped would render as identical cards, which is worse than
   * a summary that wraps to a third line.
   */
  const summaryDefs = (varying.length > 0 ? varying : identifying).slice(0, 6);
  const detailDefs = (defs ?? []).filter((d) => d.display === "detail");

  type SummaryPart = { label: string | null; value: string; ltr: boolean };

  /**
   * Returns parts rather than one joined string.
   *
   * Concatenating Persian labels with Latin values produced genuinely garbled
   * output: without isolation the bidi algorithm reorders each Latin run
   * against the surrounding RTL text, so "قطر داخلی 3mm" rendered with the
   * number detached from its label. Each value is wrapped in <bdi> instead.
   */
  function summarise(p: Item): SummaryPart[] {
    // A mixed list has a different column set per row, so each product is
    // described by its own family's leading specs.
    const perRow =
      defsByFamily && p.familyId !== undefined
        ? (() => {
            const forFamily = defsByFamily.get(p.familyId) ?? [];
            const mob = forFamily.filter((d) => d.mobile);
            return (mob.length > 0
              ? mob
              : forFamily.filter((d) => d.display === "table" || d.filterable)
            ).slice(0, 3);
          })()
        : summaryDefs;

    return perRow
      .map((d): SummaryPart | null => {
        const raw = p.specs[d.key];
        if (raw === null || raw === undefined || raw === "") return null;
        if (d.kind === "number" && typeof raw === "number") {
          // "0.21"" alone is ambiguous between ID and OD, so dimensions keep
          // their label.
          return {
            label: pick(d, "label", locale),
            value: `${formatSpecNumber(raw)}${d.unit}`,
            ltr: true,
          };
        }
        // Material, hardness and colour values name themselves — prefixing
        // "Hardness Durometer 70A" just costs width.
        const text = specValueLabel(String(raw), locale);
        return { label: null, value: text, ltr: /^[\x20-\x7E]*$/.test(text) };
      })
      .filter((x): x is SummaryPart => x !== null);
  }

  function renderSummary(parts: SummaryPart[]) {
    return parts.map((part, i) => (
      <span key={i}>
        {i > 0 && <span className="text-[var(--color-ink-faint)]"> · </span>}
        {part.label && <span>{part.label} </span>}
        <bdi className={part.ltr ? "tech" : undefined}>{part.value}</bdi>
      </span>
    ));
  }

  return (
    <ul className="divide-y divide-[var(--color-rule-light)] border-y border-[var(--color-rule-light)]">
      {products.map((p) => {
        const base = p.priceTiers[0]?.priceCents ?? p.priceCents;
        const name = p.familyEn
          ? locale === "fa"
            ? p.familyFa
            : p.familyEn
          : familyName;
        const parts = summarise(p);
        const hasSummary = parts.length > 0;

        // On a family page the heading already names the product, so the card
        // leads with what distinguishes this row instead of repeating it.
        const body = (
          <>
            <span
              className={`block leading-snug ${
                inFamily && hasSummary
                  ? "text-[13px] font-bold text-[var(--color-ink)]"
                  : "text-[14px] font-bold text-[var(--color-navy)]"
              }`}
            >
              {inFamily && hasSummary ? renderSummary(parts) : name}
            </span>
            {!inFamily && hasSummary && (
              <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink)]">
                {renderSummary(parts)}
              </span>
            )}
            <span className="tech mt-0.5 block text-[12px] font-bold text-[var(--color-ink)]">
              {p.partNumber}
            </span>
          </>
        );

        const onRequest = isPriceOnRequest(base);
        const documents = p.documents ?? [];
        const expandable =
          detailDefs.some((d) => {
            const v = p.specs[d.key];
            return v !== null && v !== undefined && v !== "";
          }) || documents.length > 0;

        return (
          // `product-card` is the hook the in-cart wash in globals.css keys on.
          <li key={p.id} className="product-card px-2 py-3">
            <div className="flex gap-3">
              <span className="shrink-0 pt-0.5">
                <ProductIcon name={p.icon ?? familyIcon ?? "box"} size={44} />
              </span>

              <div className="min-w-0 flex-1">
                {p.familySlug ? (
                  <Link
                    href={`/${locale}/f/${p.familySlug}?pn=${encodeURIComponent(p.partNumber)}`}
                    prefetch={false}
                    className="block hover:no-underline"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
                {expandable && (
                  // Same checkbox-and-CSS expander as the table, so a phone and
                  // a desktop show the same product the same way.
                  <label className="row-expand mt-1 text-[11px] text-[var(--color-navy)]">
                    <input type="checkbox" className="row-toggle" />
                    <span>{t.productDetails}</span>
                    <span className="row-caret" aria-hidden="true" />
                  </label>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={
                    onRequest
                      ? "whitespace-nowrap text-[12px] font-semibold text-[var(--color-ink-muted)]"
                      : "tech whitespace-nowrap text-[14px] font-bold"
                  }
                >
                  {onRequest ? t.callForPrice : formatPrice(base, locale, rate)}
                </span>
                <span className="whitespace-nowrap text-[10px] text-[var(--color-ink-faint)]">
                  {p.packQty > 1 ? `${t.pkg} ${formatInt(p.packQty, locale)}` : t.each}
                </span>
                <AddToCartRow productId={p.id} locale={locale} packQty={p.packQty} />
                {/* The card has no column headers, so the quantity carries its
                    own "In Cart" label. */}
                <InCartQty productId={p.id} locale={locale} showLabel />
              </div>
            </div>

            {expandable && (
              <div className="card-details">
                <ProductDetails
                  specs={p.specs}
                  defs={detailDefs}
                  documents={documents}
                  imageUrl={p.imageUrl ?? ""}
                  icon={p.icon ?? familyIcon ?? "box"}
                  locale={locale}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
