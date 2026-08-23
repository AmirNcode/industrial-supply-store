import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFamilyBySlug,
  getSpecDefs,
  getProducts,
  getProductSetSummary,
  getFacets,
  getCategoryByPath,
  getAncestors,
  type SpecDefRow,
  type ProductDetailRow,
} from "@/db/queries";
import { FacetSidebar } from "@/components/FacetSidebar";
import { MobileFilterBar } from "@/components/MobileFilterBar";
import { ActiveFilterPills } from "@/components/ActiveFilterPills";
import { Breadcrumb } from "@/components/Breadcrumb";
import { FamilyCartController } from "@/components/FamilyCartController";
import { CatalogImage } from "@/components/CatalogImage";
import { CatalogCallout } from "@/components/CatalogCallout";
import { ProductDetails } from "@/components/ProductDetails";
import { CatalogHeadReveal } from "@/components/CatalogHeadReveal";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import {
  formatInt,
  formatPriceBare,
  formatSpecNumber,
  currencyLabel,
  isPriceOnRequest,
} from "@/lib/money";
import { getFxRate } from "@/lib/fx";
import { specValueLabel, isTechnicalValue } from "@/lib/specValues";
import { summaryDefsFor, summaryParts } from "@/lib/cardSummary";
import {
  parseFilters,
  clearAllHref,
  familyWindowHref,
  countActiveFilters,
  type RawSearchParams,
} from "@/lib/filters";
import {
  FAMILY_INITIAL_ROWS,
  FAMILY_ROW_STEP,
  nextFamilyRows,
  parseFamilyWindow,
  type FamilyWindow,
} from "@/lib/familyWindow";
import { boundedString } from "@/lib/requestLimits";

/**
 * A bounded family table with an explicit whole-document escape hatch.
 *
 * The first response carries 100 products and can progressively grow to 500.
 * Buyers who specifically need browser Find or printing can opt into all rows;
 * that costly document is no longer the default for every visit. Search/cart
 * part-number links pin their target into the bounded first window.
 */
export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const sp = await searchParams;
  const family = await getFamilyBySlug(slug);
  if (!family) notFound();

  const filters = parseFilters(sp);
  const base = `/${l}/f/${slug}`;
  const window = parseFamilyWindow(sp);
  const highlighted = boundedString(sp.pn, 120)?.toUpperCase() ?? null;

  const [defs, summary, products, facets, category, ancestors, rate] = await Promise.all([
    getSpecDefs(family.id),
    getProductSetSummary(family.id, filters),
    getProducts(family.id, filters, window.rows, highlighted),
    getFacets(family.id, filters),
    getCategoryByPath(family.categoryPath),
    getAncestors(family.categoryPath),
    getFxRate(),
  ]);

  const trail = category ? [...ancestors, category] : ancestors;
  const total = summary.total;

  /*
   * Standards and lead time are family-wide facts, so they are derived once
   * here for the header pills instead of being read off every row. Only specs
   * the seeder marks non-filterable and constant qualify — a value that varies
   * across the family is a column, not a badge.
   */
  const specStandards = summary.standards.slice(0, 2);
  const maxLead = summary.maxLeadDays;
  const leadLabel =
    maxLead >= 7
      ? `${t.shipsIn} ${formatInt(Math.round(maxLead / 7), l)} ${t.weeks}`
      : maxLead > 0
        ? `${t.shipsIn} ${formatInt(maxLead, l)} ${t.days}`
        : null;
  const activeFilterCount = countActiveFilters(filters);

  return (
    // The family page drops the top-level category rail — as the reference site
    // does — and gives that width to the spec table. Persian labels are wider
    // than their English equivalents, so the table needs every pixel.
    // Bottom padding reserves room for the fixed mobile filter bar so the last
    // rows are not hidden behind it.
    <div className="px-3 pt-2 pb-24 lg:pb-0">
      <main className="min-w-0">
        <Breadcrumb
          locale={l}
          trail={trail}
          current={pick(family, "name", l)}
          count={total}
          countLabel={`${formatInt(total, l)} ${t.products}`}
        />

        <CatalogCallout locale={l} entity={family} />

        <div className="flex gap-5">
          {/*
            The section is what the sticky head is measured against. The filter
            fold pins to the top of the window and the table's own head pins
            directly beneath it, and the CSS needs one element that sees both to
            know how far down the second one sits. `CatalogHeadReveal` marks this
            element while the reader is scrolling down, which un-pins the pair —
            the same reveal the masthead does on a phone.
          */}
          <section className="min-w-0 flex-1" data-catalog-head>
            <div className="mb-2 flex items-start gap-3">
              <CatalogImage
                imageUrl={family.imageUrl}
                icon={family.icon}
                alt={pick(family, "name", l)}
                size={64}
                className="hidden h-[64px] w-[64px] object-contain sm:block"
                eager
              />
              <div className="min-w-0">
                <h1 className="text-[19px] font-bold text-[var(--color-navy)]">
                  {pick(family, "name", l)}
                </h1>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {pick(family, "desc", l)}
                </p>
                {/* Availability and standards, surfaced once for the family
                    rather than repeated down every row. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {summary.hasStock && (
                    <span className="pill pill-ok">● {t.inStock}</span>
                  )}
                  {specStandards.map((s) => (
                    <span key={s} className="pill">
                      {s}
                    </span>
                  ))}
                  {leadLabel && <span className="pill pill-warn">{leadLabel}</span>}
                </div>
              </div>
            </div>

            <CatalogHeadReveal />

            {/*
              The facets fold out above the table rather than standing beside
              it. A 210px rail is charged to every page whether or not anyone
              is filtering, and it is exactly the width a wide spec table needs
              to avoid a horizontal scrollbar. Closed by default so the table is
              the first thing on the page; opening it pushes the table down.

              Desktop only — MobileFilterBar carries the same facets at phone
              width, where a fold competing with the fixed bar would be two
              answers to one question. When filters are active the fold opens
              on the next render, keeping the state visible and easy to adjust.
            */}
            {facets.some((f) => f.values.length > 0) && (
              <details
                className="filter-fold mb-2 hidden lg:block"
                open={activeFilterCount > 0}
              >
                <summary className="filter-trigger">
                  <span className="filter-trigger-icon" aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M3 4h14l-5.5 6.2v4.6l-3 1.7v-6.3L3 4Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold text-[var(--color-navy-deep)]">
                      {t.filterBy}
                    </span>
                    <span className="block text-[11px] font-normal text-[var(--color-ink-muted)]">
                      {activeFilterCount > 0
                        ? `${formatInt(activeFilterCount, l)} ${
                            activeFilterCount === 1 ? t.filterApplied : t.filtersApplied
                          }`
                        : t.filterHelp}
                    </span>
                  </span>
                  <span className="filter-trigger-results">
                    <span className="tech font-bold">{formatInt(total, l)}</span>{" "}
                    {t.productsLower}
                  </span>
                  <span className="filter-trigger-chevron" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                      <path
                        d="m5 7.5 5 5 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </summary>
                <div className="filter-fold-content">
                  <FacetSidebar
                    locale={l}
                    base={base}
                    searchParams={sp}
                    facets={facets}
                    defs={defs}
                    filters={filters}
                    layout="band"
                  />
                </div>
              </details>
            )}

            <ActiveFilterPills
              locale={l}
              base={base}
              searchParams={sp}
              filters={filters}
              defs={defs}
            />

            {products.length === 0 ? (
              <p className="py-6 text-[13px]">
                {t.noResults}{" "}
                <Link href={clearAllHref(base, sp)} prefetch={false}>
                  {t.clearFilters}
                </Link>
              </p>
            ) : (
              /*
               * One table, two layouts.
               *
               * This used to be the table *and* a parallel card list, with one
               * hidden by CSS — which meant every row was rendered twice and
               * carried two add-to-cart islands, of which only one could ever
               * be used. On the largest family that measured 113,809 DOM nodes,
               * half of them the layout the reader cannot see. Below `lg` the
               * stylesheet folds these same rows into cards instead.
              */
              <>
                <FamilyCartController locale={l}>
                  <SpecTable
                    locale={l}
                    defs={defs}
                    products={products}
                    highlighted={highlighted}
                    rate={rate}
                    icon={family.icon}
                  />
                </FamilyCartController>
                <FamilyWindowControls
                  locale={l}
                  base={base}
                  searchParams={sp}
                  window={window}
                  shown={products.length}
                  total={total}
                />
              </>
            )}
          </section>
        </div>

        <MobileFilterBar
          locale={l}
          base={base}
          searchParams={sp}
          facets={facets}
          defs={defs}
          filters={filters}
          total={total}
        />
      </main>
    </div>
  );
}

function FamilyWindowControls({
  locale,
  base,
  searchParams,
  window,
  shown,
  total,
}: {
  locale: Locale;
  base: string;
  searchParams: RawSearchParams;
  window: FamilyWindow;
  shown: number;
  total: number;
}) {
  if (total <= FAMILY_INITIAL_ROWS && !window.showAll) return null;

  const t = getDict(locale);
  const currentRows = window.showAll ? null : window.rows;
  const nextRows = currentRows === null ? null : nextFamilyRows(currentRows, total);
  const nextCount = nextRows === null ? 0 : Math.min(FAMILY_ROW_STEP, total - shown);
  const countText = window.showAll
    ? t.showingAllProducts.replace("{total}", formatInt(total, locale))
    : t.showingProducts
        .replace("{shown}", formatInt(shown, locale))
        .replace("{total}", formatInt(total, locale));

  return (
    <nav
      className="no-print mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]"
      aria-label={t.productDisplay}
    >
      <span className="text-[var(--color-ink-muted)]">{countText}</span>
      {nextRows !== null && (
        <Link
          href={familyWindowHref(base, searchParams, nextRows)}
          prefetch={false}
          scroll={false}
          className="btn-small inline-flex items-center hover:no-underline"
        >
          {t.loadMoreProducts.replace("{count}", formatInt(nextCount, locale))}
        </Link>
      )}
      {!window.showAll && shown < total && (
        <Link
          href={familyWindowHref(base, searchParams, "all")}
          prefetch={false}
          rel="nofollow"
          className="tap inline-flex items-center"
        >
          {t.viewAllProducts}
        </Link>
      )}
      {window.showAll && total > FAMILY_INITIAL_ROWS && (
        <Link
          href={familyWindowHref(base, searchParams, null)}
          prefetch={false}
          className="tap inline-flex items-center"
        >
          {t.showFirstProducts.replace(
            "{count}",
            formatInt(FAMILY_INITIAL_ROWS, locale),
          )}
        </Link>
      )}
    </nav>
  );
}

function FamilyAddControl({
  productId,
  locale,
  packQty,
}: {
  productId: number;
  locale: Locale;
  packQty: number;
}) {
  const t = getDict(locale);
  return (
    <span className="qty-add" data-cart-line>
      <input
        type="number"
        min={1}
        data-cart-qty-input
        aria-label={`${t.qty} — ${packQty > 1 ? `${t.pkg} ${packQty}` : ""}`}
      />
      <button
        type="button"
        className="btn-small"
        data-cart-action="add"
        data-product-id={productId}
        aria-label={t.addToOrder}
      >
        +
      </button>
    </span>
  );
}

function FamilyInCart({
  productId,
  locale,
}: {
  productId: number;
  locale: Locale;
}) {
  const t = getDict(locale);
  return (
    <span data-cart-status data-product-id={productId} aria-live="polite">
      <span data-cart-empty className="text-[var(--color-ink-faint)]">
        —
      </span>
      <span data-cart-filled hidden>
        <span className="tech font-semibold" data-cart-value />
        <button
          type="button"
          data-cart-action="remove"
          data-product-id={productId}
          className="in-cart-x"
          aria-label={t.remove}
          title={t.remove}
        >
          ×
        </button>
      </span>
    </span>
  );
}

function SpecTable({
  locale,
  defs,
  products,
  highlighted,
  rate,
  icon,
}: {
  locale: Locale;
  defs: SpecDefRow[];
  products: ProductDetailRow[];
  highlighted: string | null;
  rate: number;
  icon: string;
}) {
  const t = getDict(locale);
  // Two price columns mirror the reference site's 1-9 / 10-Up quantity breaks.
  const hasBulk = products.some((p) => p.priceTiers.length > 1);

  /*
   * A family owns as many columns as its supplier keeps, which for the first
   * gate valve file is 47. Only the ones marked `table` become columns here;
   * the rest are the expanded row, reached from the part number.
   */
  const tableDefs = defs.filter((d) => d.inTable);
  const detailDefs = defs.filter((d) => d.inDetail);
  // +1 for the card cell, which is empty on desktop but still a column.
  const columnCount = tableDefs.length + (hasBulk ? 7 : 6);

  /*
   * What the phone cards lead with. Computed here, once, from the same rows
   * the table is about to render — the summary has to answer "how do these
   * rows differ", which cannot be known one row at a time.
   */
  const cardDefs = summaryDefsFor(defs, products);

  return (
    <table className="spec-table catalog-table">
      <thead>
        {/* Two-tier header: the quantity-break columns share one "Pkg." cap,
            exactly as on the reference site. */}
        <tr>
          <th className="!border-b-0" />
          <th className="!border-b-0" data-cell="card" />
          {tableDefs.map((d) => (
            <th key={d.key} className="!border-b-0" />
          ))}
          <th className="!border-b-0" />
          <th className="group" colSpan={hasBulk ? 2 : 1}>
            {t.pkg} — {currencyLabel(locale)}
          </th>
          <th className="!border-b-0" />
          <th className="!border-b-0" />
        </tr>
        <tr>
          {/* The part number leads: it is what a buyer quotes on the phone and
              types into Quick Order, so it should not be hiding past a dozen
              spec columns. */}
          <th>{t.partNumber}</th>
          {/* Carries the phone card's summary line. Empty and hidden on a
              desktop, which is why it has no heading. */}
          <th data-cell="card" />
          {tableDefs.map((d) => (
            <th key={d.key} className={d.kind === "number" ? "num" : undefined}>
              {pick(d, "label", locale)}
            </th>
          ))}
          <th className="num">{t.pkgQty}</th>
          {/* Quantity-break captions are Latin ranges; they must not mirror. */}
          <th className="num tech tech-num price-col">1–9</th>
          {hasBulk && <th className="num tech tech-num price-col">10+</th>}
          <th>{t.qty}</th>
          <th>{t.inCart}</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => {
          const isHit = highlighted && p.partNumber.toUpperCase() === highlighted;
          const base = p.priceTiers[0]?.priceCents ?? p.priceCents;
          const bulk = p.priceTiers[1]?.priceCents;
          const onRequest = isPriceOnRequest(base);
          const expandable =
            detailDefs.some((d) => {
              const v = p.specs[d.key];
              return v !== null && v !== undefined && v !== "";
            }) || p.documents.length > 0;

          return (
            <Fragment key={p.id}>
              <tr
                // A wash alone no longer separates this from a hovered row now
                // that both are navy; `.row-hit` adds an outline that survives
                // the pointer passing over it.
                className={isHit ? "product-row row-hit" : "product-row"}
              >
                <td data-cell="part">
                  {expandable ? (
                    // A checkbox and CSS rather than a client component: the
                    // detail content is server-rendered, and a hundred rows of
                    // hydrated toggle state buys nothing over `:has()`.
                    //
                    // The checkbox carries an id so cells further along the row
                    // can point a plain `<label for>` at it — one row, one
                    // toggle, several ways to reach it.
                    <label className="row-expand" htmlFor={`row-${p.id}`}>
                      <input type="checkbox" className="row-toggle" id={`row-${p.id}`} />
                      <span className="part-no tech">{p.partNumber}</span>
                      <span className="row-caret" aria-hidden="true" />
                    </label>
                  ) : (
                    <span className="part-no tech">{p.partNumber}</span>
                  )}
                </td>
                {/*
                  The phone card's summary line, and the only content on the
                  row that a desktop never shows. It is a few short values
                  rather than a second copy of the row — the alternative was
                  rendering the whole product again in a parallel card list.
                */}
                <td data-cell="card">
                  <span className="card-summary">
                    {summaryParts(p.specs, cardDefs, locale).map((part, i) => (
                      <span key={i}>
                        {i > 0 && <span className="text-[var(--color-ink-faint)]"> · </span>}
                        {part.label && <span>{part.label} </span>}
                        <bdi className={part.ltr ? "tech" : undefined}>{part.value}</bdi>
                      </span>
                    ))}
                  </span>
                  {/* The card has no "Pkg. Qty" column to read this from. */}
                  <span className="card-pack">
                    {p.packQty > 1 ? `${t.pkg} ${formatInt(p.packQty, locale)}` : t.each}
                  </span>
                </td>
                {tableDefs.map((d, col) => {
                  const raw = p.specs[d.key];
                  const isNum = d.kind === "number" && typeof raw === "number";
                  const text =
                    raw === null || raw === undefined || raw === ""
                      ? "—"
                      : isNum
                        ? formatSpecNumber(raw as number)
                        : specValueLabel(String(raw), locale);
                  // Only genuinely technical values (dimensions, codes, untranslated
                  // Latin strings) get forced LTR. Translated words like
                  // "بونا-ان (نیتریل)" must follow the page direction, or mixed
                  // runs inside them reorder wrongly.
                  const technical = isNum || isTechnicalValue(text);
                  /*
                   * The leading spec column opens the row too.
                   *
                   * It is the product's name in every family that has one, and
                   * a name is what a reader clicks. Only the first: making every
                   * cell a target would swallow text selection across the table.
                   */
                  const opens = expandable && col === 0 && !isNum;
                  return (
                    <td
                      key={d.key}
                      className={
                        isNum ? "num tech tech-num" : technical ? "tech" : undefined
                      }
                    >
                      {opens ? (
                        <label className="row-expand" htmlFor={`row-${p.id}`}>
                          <span className="row-name">{text}</span>
                          <span className="row-caret" aria-hidden="true" />
                        </label>
                      ) : (
                        <>
                          {text}
                          {isNum && d.unit ? d.unit : ""}
                        </>
                      )}
                    </td>
                  );
                })}
                <td className="num tech tech-num" data-cell="pack">
                  {p.packQty}
                </td>
                {/* Bare amounts — the currency is named once in the group header.
                    Repeating "تومان" on 200 rows costs ~40px of table width and
                    tells the buyer nothing they don't already know. */}
                <td
                  data-cell="price"
                  className={
                    onRequest
                      ? "num price-col text-[11px] text-[var(--color-ink-muted)]"
                      : "num tech tech-num price-col font-semibold"
                  }
                >
                  {onRequest ? t.callForPriceShort : formatPriceBare(base, locale, rate)}
                </td>
                {hasBulk && (
                  <td
                    data-cell="bulk"
                    className="num tech tech-num price-col text-[var(--color-ink-muted)]"
                  >
                    {bulk !== undefined && !isPriceOnRequest(bulk)
                      ? formatPriceBare(bulk, locale, rate)
                      : ""}
                  </td>
                )}
                <td data-cell="qty">
                  <FamilyAddControl
                    productId={p.id}
                    locale={locale}
                    packQty={p.packQty}
                  />
                </td>
                <td className="in-cart-col" data-cell="cart">
                  <FamilyInCart productId={p.id} locale={locale} />
                </td>
              </tr>
              {expandable && (
                <tr className="detail-row">
                  <td colSpan={columnCount}>
                    <ProductDetails
                      specs={p.specs}
                      defs={detailDefs}
                      documents={p.documents}
                      imageUrl={p.imageUrl}
                      imageAlt={p.partNumber}
                      icon={icon}
                      locale={locale}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
