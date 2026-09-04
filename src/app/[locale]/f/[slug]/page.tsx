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
import { CatalogImageLightbox } from "@/components/CatalogImageLightbox";
import { ProductDetails } from "@/components/ProductDetails";
import { CatalogHeadReveal } from "@/components/CatalogHeadReveal";
import { calloutArt, paragraphs } from "@/lib/catalogCallout";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import {
  formatInt,
  formatPriceBare,
  formatSpecNumber,
  currencyLabel,
  customerCurrencyFor,
  isPriceOnRequest,
  type Currency,
} from "@/lib/money";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
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

  const [defs, summary, products, facets, category, ancestors, rate, priceDisplayMode] = await Promise.all([
    getSpecDefs(family.id),
    getProductSetSummary(family.id, filters),
    getProducts(family.id, filters, window.rows, highlighted),
    getFacets(family.id, filters),
    getCategoryByPath(family.categoryPath),
    getAncestors(family.categoryPath),
    getFxRate(),
    getPriceDisplayMode(),
  ]);
  const currency = customerCurrencyFor(priceDisplayMode, l);

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
  const familyName = pick(family, "name", l);
  const art = calloutArt(family);
  const about = paragraphs(pick(family, "about", l));

  /*
   * Whether the rail starts folded to its 44px edge.
   *
   * The fold this rail replaced existed to keep 210px for the table, and that
   * reason has not gone away — it just does not apply to every family. Ten
   * columns fit beside a rail on a laptop; the gate valve file's forty-seven do
   * not, and there the reader wants the width first and the facets on request.
   */
  const wideTable = defs.filter((d) => d.inTable).length > 12;

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

        <div className="flex gap-4">
          {/*
            Facets stand beside the table again rather than folding out above
            it, so a value's count is read while the results it would produce
            are on screen. The width that bought the fold is given back by the
            rail's own fold — see `FacetSidebar` — which starts closed on the
            families whose tables want the room.
          */}
          <FacetSidebar
            locale={l}
            base={base}
            searchParams={sp}
            facets={facets}
            defs={defs}
            filters={filters}
            collapsed={wideTable}
          />

          {/*
            The section is what the sticky head is measured against. The result
            toolbar pins to the top of the window and the table's own head pins
            directly beneath it, and the CSS needs one element that sees both to
            know how far down the second one sits. `CatalogHeadReveal` marks this
            element while the reader is scrolling down, which un-pins the pair —
            the same reveal the masthead does on a phone.
          */}
          <section className="min-w-0 flex-1" data-catalog-head>
            {/*
              The identity block. What used to be two things stacked — a small
              header and a tinted "About" callout under it — is one: a diagram,
              the name, what it costs you to wait for it, and the prose that
              explains the choice. They were always answering the same question,
              and splitting it across two boxes spent about 150px of the first
              screen on saying the family's name twice.

              `/c/…` and `/l/…` keep `CatalogCallout`; a category has no table
              under it to make room for.
            */}
            <div className="mb-3 flex flex-col gap-4 border-b border-[var(--color-rule)] pb-3.5 sm:flex-row sm:items-start">
              {/*
                The wrapper reserves the space so a picture of any shape arrives
                without moving the text. 3:2 landscape because a dimension
                drawing is a part seen side-on with a measurement across it —
                the same reason `calloutArt` sizes it that way — but at the
                header's height rather than the callout's, since it now sits
                beside the prose instead of above the table.
              */}
              <div
                className={
                  art.isDiagram
                    ? "flex h-[104px] w-[156px] shrink-0 items-center justify-center"
                    : "shrink-0"
                }
              >
                <CatalogImageLightbox
                  imageUrl={art.imageUrl}
                  icon={art.icon}
                  alt={familyName}
                  size={art.size}
                  className={
                    art.isDiagram ? "object-contain" : "h-[46px] w-[46px] object-contain"
                  }
                  eager
                  openLabel={`${t.viewImageFullSize} ${familyName}`}
                  closeLabel={t.closeImage}
                  fillThumbnail={art.isDiagram}
                />
              </div>
              <div className="min-w-0">
                {/* Availability and standards sit on the heading's own baseline
                    rather than under it: they qualify the name, and a buyer
                    deciding whether to read on wants both in one glance. Family
                    facts, surfaced once, not repeated down every row. */}
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
                  <h1 className="text-[22px] font-bold text-[var(--color-navy-deep)]">
                    {familyName}
                  </h1>
                  {summary.hasStock && (
                    <span className="pill pill-ok">● {t.inStock}</span>
                  )}
                  {leadLabel && <span className="pill pill-warn">{leadLabel}</span>}
                  {specStandards.map((s) => (
                    <span key={s} className="pill">
                      {s}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[12px] text-[var(--color-ink-muted)]">
                  {pick(family, "desc", l)}
                </p>
                {about.map((para, index) => (
                  <p
                    key={index}
                    className="mt-1.5 max-w-[76ch] text-[12.5px] leading-relaxed text-[var(--color-ink)]"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </div>

            <CatalogHeadReveal />

            {/*
              What the fold's summary used to say, minus the control — the rail
              is the control now. It pins with the table head, so a reader a
              thousand rows down still has the count the filters produced next
              to the columns they are reading.
            */}
            <div className="catalog-toolbar mb-2">
              <span>
                <span className="tech font-bold text-[var(--color-ink)]">
                  {formatInt(total, l)}
                </span>{" "}
                {t.productsLower}
                {activeFilterCount > 0 && (
                  <>
                    {" · "}
                    {formatInt(activeFilterCount, l)}{" "}
                    {activeFilterCount === 1 ? t.filterApplied : t.filtersApplied}
                  </>
                )}
              </span>
              {/* The escape hatch to a printable, Find-able whole document. It
                  is a property of the table rather than of the row window, so
                  it sits over the table with the count it would change. */}
              {!window.showAll && products.length < total && (
                <Link
                  href={familyWindowHref(base, sp, "all")}
                  prefetch={false}
                  rel="nofollow"
                  className="no-print ms-auto"
                >
                  {t.viewAllProducts}
                </Link>
              )}
            </div>

            {/* Phones only: the rail carries these on a desktop, where a filter
                belongs beside the control that set it rather than above the
                results it removed. */}
            <div className="lg:hidden">
              <ActiveFilterPills
                locale={l}
                base={base}
                searchParams={sp}
                filters={filters}
                defs={defs}
              />
            </div>

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
              <FamilyCartController locale={l}>
                <SpecTable
                  locale={l}
                  defs={defs}
                  products={products}
                  highlighted={highlighted}
                  currency={currency}
                  rate={rate}
                  icon={family.icon}
                />
                {/* Inside the controller so the running order total can be
                    written by the same delegation that fills the "In cart"
                    cells — a second client island for one number would be one
                    island too many on a page that has worked hard to have one. */}
                <TableFooter
                  locale={l}
                  base={base}
                  searchParams={sp}
                  window={window}
                  shown={products.length}
                  total={total}
                />
              </FamilyCartController>
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

/**
 * The table's foot: how much of the family is on screen, how to see more of it,
 * and how much of it is already on the order.
 *
 * The window controls used to sit below the table card as a bare nav. They are
 * the card's own footer now — the same line as the running order total, which
 * is the thing a buyer working down a hundred rows is actually keeping track
 * of. `data-cart-total` is filled by `FamilyCartController`.
 */
function TableFooter({
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
  const t = getDict(locale);
  const bounded = total > FAMILY_INITIAL_ROWS || window.showAll;
  const currentRows = window.showAll ? null : window.rows;
  const nextRows = currentRows === null ? null : nextFamilyRows(currentRows, total);
  const nextCount = nextRows === null ? 0 : Math.min(FAMILY_ROW_STEP, total - shown);
  const countText = window.showAll
    ? t.showingAllProducts.replace("{total}", formatInt(total, locale))
    : t.showingProducts
        .replace("{shown}", formatInt(shown, locale))
        .replace("{total}", formatInt(total, locale));

  return (
    <div className="catalog-footer" aria-label={t.productDisplay}>
      {bounded && (
        <>
          <span>{countText}</span>
          {nextRows !== null && (
            <Link
              href={familyWindowHref(base, searchParams, nextRows)}
              prefetch={false}
              scroll={false}
              className="btn-small no-print inline-flex items-center hover:no-underline"
            >
              {t.loadMoreProducts.replace("{count}", formatInt(nextCount, locale))}
            </Link>
          )}
          {window.showAll && total > FAMILY_INITIAL_ROWS && (
            <Link
              href={familyWindowHref(base, searchParams, null)}
              prefetch={false}
              className="tap no-print inline-flex items-center"
            >
              {t.showFirstProducts.replace(
                "{count}",
                formatInt(FAMILY_INITIAL_ROWS, locale),
              )}
            </Link>
          )}
        </>
      )}
      {/*
        Hidden until the controller has a count above zero. Rendered empty on
        the server rather than conditionally, because the cart lives in client
        state — a server that knew it would make this page dynamic and cost the
        catalog its cache. See `CartLink`.
      */}
      <span className="catalog-footer-order no-print" data-cart-total hidden>
        <span className="font-semibold text-[var(--color-navy-deep)]">
          <span className="tech" data-cart-total-value />
          {" "}
          {t.itemsInOrder}
        </span>
        <Link
          href={`/${locale}/cart`}
          prefetch={false}
          className="btn-small inline-flex items-center hover:no-underline"
        >
          {t.reviewOrder}
        </Link>
      </span>
    </div>
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
  currency,
  rate,
  icon,
}: {
  locale: Locale;
  defs: SpecDefRow[];
  products: ProductDetailRow[];
  highlighted: string | null;
  currency: Currency;
  rate: number;
  icon: string;
}) {
  const t = getDict(locale);

  /*
   * A family owns as many columns as its supplier keeps, which for the first
   * gate valve file is 47. Only the ones marked `table` become columns here;
   * the rest are the expanded row, reached from the part number.
   */
  const tableDefs = defs.filter((d) => d.inTable);
  const detailDefs = defs.filter((d) => d.inDetail);
  /*
   * Part no., the phone card cell, the spec columns, pack, price, in-cart.
   *
   * The grid used to carry two more: a second price for the 10-up break, and a
   * quantity box. The break is a fact only a buyer choosing a quantity needs,
   * and the box only matters to one who has chosen — both are in the expanded
   * row's order panel now, where the choice is actually made.
   */
  const columnCount = tableDefs.length + 5;

  /*
   * What the phone cards lead with. Computed here, once, from the same rows
   * the table is about to render — the summary has to answer "how do these
   * rows differ", which cannot be known one row at a time.
   */
  const cardDefs = summaryDefsFor(defs, products);

  return (
    <table className="spec-table catalog-table">
      {/* One tier. The second existed only to cap the pair of price columns,
          and there is one price column now. */}
      <thead>
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
          {/* The currency is named once, here, rather than on every row. */}
          <th className="num price-head">
            {t.price} / {t.pkg} — {currencyLabel(currency, locale)}
          </th>
          <th>{t.inCart}</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => {
          const isHit = highlighted && p.partNumber.toUpperCase() === highlighted;
          const base = p.priceTiers[0]?.priceCents ?? p.priceCents;
          const onRequest = isPriceOnRequest(base);

          return (
            <Fragment key={p.id}>
              <tr
                // A wash alone no longer separates this from a hovered row now
                // that both are navy; `.row-hit` adds an outline that survives
                // the pointer passing over it.
                className={isHit ? "product-row row-hit" : "product-row"}
              >
                <td data-cell="part">
                  {/*
                    A checkbox and CSS rather than a client component: the
                    detail content is server-rendered, and a hundred rows of
                    hydrated toggle state buys nothing over `:has()`.

                    The checkbox carries an id so cells further along the row
                    can point a plain `<label for>` at it — one row, one
                    toggle, several ways to reach it.

                    Every row opens, including one whose family declares no
                    detail columns. The detail is where the price ladder and
                    ADD live now, so a row that could not open would be a
                    product nobody could buy.
                  */}
                  <label className="row-expand" htmlFor={`row-${p.id}`}>
                    <input type="checkbox" className="row-toggle" id={`row-${p.id}`} />
                    <span className="part-no tech">{p.partNumber}</span>
                    <span className="row-caret" aria-hidden="true" />
                  </label>
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
                  const opens = col === 0 && !isNum;
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
                    Repeating "ریال" on 200 rows costs table width and
                    tells the buyer nothing they don't already know. */}
                <td
                  data-cell="price"
                  className={
                    onRequest
                      ? "num price-col text-[11px] text-[var(--color-ink-muted)]"
                      : "num tech tech-num price-col font-semibold"
                  }
                >
                  {onRequest
                    ? t.callForPriceShort
                    : formatPriceBare(base, currency, locale, rate)}
                </td>
                {/* A read-out, not a control. The quantity is set in the row's
                    own order panel; what belongs in the grid is the answer to
                    "have I already taken this size", which is what a buyer
                    scanning a hundred rows keeps losing track of. */}
                <td className="in-cart-col" data-cell="cart">
                  <FamilyInCart productId={p.id} locale={locale} />
                </td>
              </tr>
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
                    order={{
                      productId: p.id,
                      packQty: p.packQty,
                      priceCents: p.priceCents,
                      priceTiers: p.priceTiers,
                      inStock: p.inStock,
                      leadDays: p.leadDays,
                      currency,
                      rate,
                    }}
                  />
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
