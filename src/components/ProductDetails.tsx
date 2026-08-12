import type { SpecDefRow } from "@/db/queries";
import type { ProductDocument, SpecBag } from "@/db/schema";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { formatSpecNumber } from "@/lib/money";
import { specValueLabel, isTechnicalValue } from "@/lib/specValues";
import { ProductIcon } from "./ProductIcon";

/**
 * Everything about a product that does not fit in the row.
 *
 * A family can hold far more columns than a table can show — the first gate
 * valve file has 47 — so the columns marked `detail` live here instead, and the
 * table keeps the handful that tell two products apart. Rendered on the server:
 * the expanded row is opened with a checkbox and CSS, so there is no state and
 * nothing to hydrate.
 *
 * Shared by the desktop table and the phone cards so the two cannot describe
 * the same product differently.
 */
export function ProductDetails({
  specs,
  defs,
  documents,
  imageUrl,
  imageAlt,
  icon,
  locale,
}: {
  specs: SpecBag;
  /** Only the `detail`-tier columns; the caller has already split them. */
  defs: SpecDefRow[];
  documents: ProductDocument[];
  imageUrl: string;
  imageAlt: string;
  icon: string;
  locale: Locale;
}) {
  const t = getDict(locale);

  // A column the family declares but this product has no value for would
  // otherwise print a row of dashes down the whole list.
  const rows = defs.filter((d) => {
    const v = specs[d.key];
    return v !== null && v !== undefined && v !== "";
  });

  return (
    // `detail-sticky` pins this to the left edge of the scroll viewport. The
    // row it sits in spans a table that is usually wider than the screen — a
    // 47-column family always is — so without it the second column of specs
    // sits off-screen and is only reachable by scrolling the table sideways.
    <div className="detail-sticky flex flex-wrap items-start gap-4 px-2 py-3">
      <div className="flex w-[120px] shrink-0 flex-col items-center gap-1">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- product images
          // are supplier-hosted at arbitrary sizes; next/image would need every
          // host allow-listed before a single one renders.
          <img
            src={imageUrl}
            alt={imageAlt}
            className="max-h-[110px] w-full rounded-[3px] border border-[var(--color-rule-light)] object-contain"
          />
        ) : (
          <span className="flex h-[110px] w-full flex-col items-center justify-center gap-1 rounded-[3px] border border-dashed border-[var(--color-rule)] bg-[var(--color-paper)]">
            <ProductIcon name={icon} size={40} />
            <span className="text-[10px] text-[var(--color-ink-faint)]">
              {t.productNoImage}
            </span>
          </span>
        )}
      </div>

      <div className="min-w-[240px] flex-1">
        <h4 className="mb-1 text-[12px] font-bold text-[var(--color-navy)]">
          {t.productDetails}
        </h4>
        {rows.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">—</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {rows.map((d) => {
              const raw = specs[d.key];
              const isNum = d.kind === "number" && typeof raw === "number";
              const text = isNum
                ? formatSpecNumber(raw as number)
                : specValueLabel(String(raw), locale);
              // Same rule as the table: only genuinely technical values are
              // forced LTR, or translated Persian phrases reorder wrongly.
              const technical = isNum || isTechnicalValue(text);
              return (
                <div
                  key={d.key}
                  className="flex items-baseline justify-between gap-3 border-b border-dotted border-[var(--color-rule-light)] py-0.5"
                >
                  <dt className="text-[11px] text-[var(--color-ink-muted)]">
                    {pick(d, "label", locale)}
                  </dt>
                  <dd className={`text-[11px] font-semibold ${technical ? "tech" : ""}`}>
                    <bdi>
                      {text}
                      {isNum && d.unit ? d.unit : ""}
                    </bdi>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {documents.length > 0 && (
          <>
            <h4 className="mt-2.5 mb-1 text-[12px] font-bold text-[var(--color-navy)]">
              {t.productDocuments}
            </h4>
            <ul className="flex flex-wrap gap-1.5">
              {documents.map((doc, i) => (
                <li key={i}>
                  {doc.url ? (
                    <a className="pill" href={doc.url} target="_blank" rel="noopener noreferrer">
                      {doc.label}
                    </a>
                  ) : (
                    // A supplier file names the documents long before the PDFs
                    // exist. Saying so is better than a link that 404s.
                    <span className="pill text-[var(--color-ink-muted)]">
                      {doc.label}{" "}
                      <span className="text-[var(--color-ink-faint)]">
                        · {t.productDocumentPending}
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
