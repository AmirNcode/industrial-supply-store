import { Fragment } from "react";
import type { SpecDefRow } from "@/db/queries";
import type { PriceTier, ProductDocument, SpecBag } from "@/db/schema";
import { getDict, pick, type Locale } from "@/lib/i18n";
import {
  currencyLabel,
  formatInt,
  formatPriceBare,
  formatSpecNumber,
  isPriceOnRequest,
  type Currency,
} from "@/lib/money";
import { specValueLabel, isTechnicalValue } from "@/lib/specValues";
import { ProductIcon } from "./ProductIcon";

/**
 * Everything about a product that does not fit in the row — including buying it.
 *
 * A family can hold far more columns than a table can show — the first gate
 * valve file has 47 — so the columns marked `detail` live here instead, and the
 * table keeps the handful that tell two products apart. Rendered on the server:
 * the expanded row is opened with a checkbox and CSS, so there is no state and
 * nothing to hydrate.
 *
 * The order panel is here rather than in the grid because a quantity box and an
 * ADD button on every row is a column of controls a scanning reader has to read
 * past on the way to the next dimension. Committing to a size is one step, and
 * it now happens in one place, beside the price it costs and the specifications
 * that justify it. The grid keeps "In cart" as a read-out, so a buyer working
 * down a hundred rows can still see what they have taken without opening any.
 *
 * The controls carry `data-cart-*` and are driven by `FamilyCartController`, so
 * a hundred open-able panels still cost one client component for the table.
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
  order,
}: {
  specs: SpecBag;
  /** Only the `detail`-tier columns; the caller has already split them. */
  defs: SpecDefRow[];
  documents: ProductDocument[];
  imageUrl: string;
  imageAlt: string;
  icon: string;
  locale: Locale;
  /**
   * Omitted where the caller already has an ADD of its own. The list page's
   * cards carry one on the card face, so a second inside the fold would be two
   * ways to buy the same product on one screen; the family table has none in
   * the grid, which is why this exists.
   */
  order?: OrderPanelProps;
}) {
  const t = getDict(locale);

  // A column the family declares but this product has no value for would
  // otherwise print a row of dashes down the whole list.
  const rows = defs.filter((d) => {
    const v = specs[d.key];
    return v !== null && v !== undefined && v !== "";
  });

  /*
   * A family whose columns are all `table`-tier has nothing to say down here,
   * and this row is emitted for all of its products whether or not anyone opens
   * one — so the picture, the heading and the row of dashes under it would be
   * ~16 elements per product describing nothing. Measured on `ball-bearings`,
   * which has no detail columns at all: skipping them takes the panel's cost
   * over 100 rows from +37.7 KB to +27.9 KB gzipped.
   */
  const bare = rows.length === 0 && documents.length === 0;
  if (bare) {
    return (
      <div className="detail-sticky flex px-2 py-3">
        {order && <OrderPanel {...order} locale={locale} />}
      </div>
    );
  }

  return (
    // `detail-sticky` pins this to the left edge of the scroll viewport. The
    // row it sits in spans a table that is usually wider than the screen — a
    // 47-column family always is — so without it the second column of specs
    // sits off-screen and is only reachable by scrolling the table sideways.
    <div className="detail-sticky flex flex-wrap items-start gap-4 px-2 py-3">
      <div className="flex w-[120px] shrink-0 flex-col items-center gap-1">
        {imageUrl ? (
          // Supplier images may use HTTP or arbitrary hosts, so Next's HTTPS
          // optimiser cannot safely handle every value accepted by the admin.
          // eslint-disable-next-line @next/next/no-img-element
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
          // Reachable when the product has documents but no detail values.
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

      {order && <OrderPanel {...order} locale={locale} />}
    </div>
  );
}

/**
 * Price, quantity and ADD for one product.
 *
 * The stepper's buttons and the field carry `data-cart-*` rather than their own
 * handlers: `FamilyCartController` delegates for the whole table, so opening
 * fifty rows still costs one client component. The ADD button keeps a constant
 * `aria-label` because the controller swaps its visible text to "…" and "✓" —
 * an accessible name that changed under a screen reader mid-press would be a
 * different button.
 */
export type OrderPanelProps = {
  productId: number;
  packQty: number;
  priceCents: number;
  priceTiers: PriceTier[];
  inStock: boolean;
  leadDays: number;
  currency: Currency;
  rate: number;
};

function OrderPanel({
  productId,
  packQty,
  priceCents,
  priceTiers,
  inStock,
  leadDays,
  currency,
  rate,
  locale,
}: OrderPanelProps & { locale: Locale }) {
  const t = getDict(locale);
  const base = priceTiers[0]?.priceCents ?? priceCents;
  const onRequest = isPriceOnRequest(base);
  // Quantity breaks used to be a second price column charged to every row. Only
  // a reader who has opened this panel is choosing a quantity, so the whole
  // ladder can be spelled out here instead of the top rung being shown to
  // everyone and the rest to nobody.
  const tiers = priceTiers.length > 1 ? priceTiers : [];
  const leadLabel =
    leadDays >= 7
      ? `${t.shipsIn} ${formatInt(Math.round(leadDays / 7), locale)} ${t.weeks}`
      : leadDays > 0
        ? `${t.shipsIn} ${formatInt(leadDays, locale)} ${t.days}`
        : null;

  return (
    <div className="order-panel" data-cart-line>
      <div>
        {onRequest ? (
          <div className="text-[13px] font-semibold text-[var(--color-ink-muted)]">
            {t.callForPrice}
          </div>
        ) : (
          <>
            <div className="order-price">
              <bdi className="tech">{formatPriceBare(base, currency, locale, rate)}</bdi>{" "}
              <span className="order-price-unit">
                {currencyLabel(currency, locale)} / {t.pkg}
              </span>
            </div>
            <div className="order-pack">
              {packQty > 1 ? `${t.pkg} ${formatInt(packQty, locale)}` : t.each}
            </div>
          </>
        )}
      </div>

      {tiers.length > 0 && !onRequest && (
        <div className="order-tiers">
          {tiers.map((tier, i) => (
            <Fragment key={tier.minQty}>
              <span className="tech text-[var(--color-ink-muted)]">
                {/* Latin ranges: "10+" must not mirror under RTL. */}
                {i === tiers.length - 1
                  ? `${formatInt(tier.minQty, locale)}+`
                  : `${formatInt(tier.minQty, locale)}–${formatInt(
                      tiers[i + 1]!.minQty - 1,
                      locale,
                    )}`}
              </span>
              <span className="tech text-end font-semibold">
                {formatPriceBare(tier.priceCents, currency, locale, rate)}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label className="qty-label">
          <span>{t.qty}</span>
          <span className="qty-step">
            <button
              type="button"
              data-cart-action="step"
              data-cart-step="-1"
              aria-label={t.remove}
              tabIndex={-1}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              defaultValue={1}
              data-cart-qty-input
              aria-label={`${t.qty}${packQty > 1 ? ` — ${t.pkg} ${packQty}` : ""}`}
            />
            <button
              type="button"
              data-cart-action="step"
              data-cart-step="1"
              aria-label={t.add}
              tabIndex={-1}
            >
              +
            </button>
          </span>
        </label>
        {packQty > 1 && (
          <span className="pb-2 text-[11px] text-[var(--color-ink-muted)]">
            {t.pkg}
          </span>
        )}
      </div>

      <span className="order-stock" data-stock={inStock ? "in" : "out"}>
        ● {inStock ? t.inStock : t.madeToOrder}
        {leadLabel ? ` — ${leadLabel}` : ""}
      </span>

      <button
        type="button"
        className="btn-small order-add"
        data-cart-action="add"
        data-product-id={productId}
        aria-label={t.addToOrder}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M2.5 3h2.2l2 9.2h8.6l1.7-6.4H6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="16" r="1.3" fill="currentColor" />
          <circle cx="14.6" cy="16" r="1.3" fill="currentColor" />
        </svg>
        <span data-cart-label>{t.addToOrder}</span>
      </button>
    </div>
  );
}
