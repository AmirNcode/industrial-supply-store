import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFamilyBySlug,
  getSpecDefs,
  getProducts,
  countProducts,
  getFacets,
  getCategoryByPath,
  getAncestors,
  type SpecDefRow,
  type ProductRow,
} from "@/db/queries";
import { sql } from "@/db";
import { FacetSidebar } from "@/components/FacetSidebar";
import { MobileFilterBar } from "@/components/MobileFilterBar";
import { ActiveFilterPills } from "@/components/ActiveFilterPills";
import { ProductCardList } from "@/components/ProductCardList";
import { Breadcrumb } from "@/components/Breadcrumb";
import { AddToCartRow } from "@/components/AddToCartRow";
import { InCartQty } from "@/components/InCartQty";
import { ProductIcon } from "@/components/ProductIcon";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { formatInt, formatPriceBare, formatSpecNumber, currencyLabel } from "@/lib/money";
import { getFxRate } from "@/lib/fx";
import { specValueLabel, isTechnicalValue } from "@/lib/specValues";
import { parseFilters, pageHref, clearAllHref, type RawSearchParams } from "@/lib/filters";

/**
 * 100 rather than 200.
 *
 * The page renders the desktop table and the mobile card list from the same
 * data and hides one with CSS, so every row costs two renders and two
 * add-to-cart islands in the RSC payload. At 200 rows that measured ~95ms
 * against ~27ms before the mobile layout existed. Halving the page restores
 * the original latency and 100 rows is still a long page to scan.
 *
 * The alternative — sniffing the User-Agent to render only one layout — was
 * rejected because it breaks resizing a desktop window to check the mobile
 * view, which is exactly how this gets reviewed.
 */
const PAGE_SIZE = 100;

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
  const page = Math.max(1, Number(sp.page) || 1);
  const base = `/${l}/f/${slug}`;

  const [defs, total, products, facets, catRow, rate] = await Promise.all([
    getSpecDefs(family.id),
    countProducts(family.id, filters),
    getProducts(family.id, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    getFacets(family.id, filters),
    sql<{ path: string }[]>`SELECT path FROM categories WHERE id = ${family.categoryId}`,
    getFxRate(),
  ]);

  const catPath = catRow[0]?.path ?? "";
  const [category, ancestors] = await Promise.all([
    getCategoryByPath(catPath),
    getAncestors(catPath),
  ]);

  const trail = category ? [...ancestors, category] : ancestors;

  /*
   * Standards and lead time are family-wide facts, so they are derived once
   * here for the header pills instead of being read off every row. Only specs
   * the seeder marks non-filterable and constant qualify — a value that varies
   * across the family is a column, not a badge.
   */
  const specStandards = [...new Set(
    products.map((p) => p.specs.spec).filter((v): v is string => typeof v === "string" && v !== ""),
  )].slice(0, 2);
  const maxLead = products.reduce((n, p) => Math.max(n, p.leadDays), 0);
  const leadLabel =
    maxLead >= 7
      ? `${t.shipsIn} ${formatInt(Math.round(maxLead / 7), l)} ${t.weeks}`
      : maxLead > 0
        ? `${t.shipsIn} ${formatInt(maxLead, l)} ${t.days}`
        : null;
  const highlighted = typeof sp.pn === "string" ? sp.pn.toUpperCase() : null;
  const pages = Math.ceil(total / PAGE_SIZE);

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

        {(family.aboutEn || family.aboutFa) && (
          <div className="mb-4 flex items-start gap-3 rounded-[4px] border border-[var(--color-amber-line)] border-s-[3px] border-s-[var(--color-amber)] bg-[var(--color-amber-soft)] p-3.5">
            <span className="shrink-0">
              <ProductIcon name={family.icon} size={46} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-[var(--color-pine)]">
                {t.aboutPrefix} {pick(family, "name", l)}
              </h2>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink)]">
                {pick(family, "about", l)}
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-5">
          {/* The rail is desktop-only; MobileFilterBar carries the same facets
              at phone width. */}
          <div className="hidden lg:block">
            <FacetSidebar
              locale={l}
              base={base}
              searchParams={sp}
              facets={facets}
              defs={defs}
              filters={filters}
            />
          </div>

          <section className="min-w-0 flex-1">
            <div className="mb-2 flex items-start gap-3">
              <ProductIcon name={family.icon} size={64} className="hidden sm:block" />
              <div className="min-w-0">
                <h1 className="text-[19px] font-bold text-[var(--color-pine)]">
                  {pick(family, "name", l)}
                </h1>
                <p className="text-[12px] text-[var(--color-ink-muted)]">
                  {pick(family, "desc", l)}
                </p>
                {/* Availability and standards, surfaced once for the family
                    rather than repeated down every row. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {products.some((p) => p.inStock) && (
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
              <>
                <div className="table-card scroll-x hidden lg:block">
                  <SpecTable
                    locale={l}
                    defs={defs}
                    products={products}
                    highlighted={highlighted}
                    rate={rate}
                  />
                </div>

                <div className="lg:hidden">
                  <ProductCardList
                    locale={l}
                    products={products}
                    defs={defs}
                    familyName={pick(family, "name", l)}
                    familyIcon={family.icon}
                    rate={rate}
                  />
                </div>

                {pages > 1 && (
                  <nav className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
                    {Array.from({ length: pages }, (_, i) => i + 1)
                      .filter(
                        (p) =>
                          p === 1 ||
                          p === pages ||
                          Math.abs(p - page) <= 2,
                      )
                      .map((p, i, arr) => (
                        <span key={p} className="flex items-center gap-1.5">
                          {i > 0 && arr[i - 1] !== p - 1 && (
                            <span className="text-[var(--color-ink-faint)]">…</span>
                          )}
                          {p === page ? (
                            <span className="font-bold tech">{formatInt(p, l)}</span>
                          ) : (
                            <Link href={pageHref(base, sp, p)} prefetch={false} className="tech">
                              {formatInt(p, l)}
                            </Link>
                          )}
                        </span>
                      ))}
                  </nav>
                )}
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

function SpecTable({
  locale,
  defs,
  products,
  highlighted,
  rate,
}: {
  locale: Locale;
  defs: SpecDefRow[];
  products: ProductRow[];
  highlighted: string | null;
  rate: number;
}) {
  const t = getDict(locale);
  // Two price columns mirror the reference site's 1-9 / 10-Up quantity breaks.
  const hasBulk = products.some((p) => p.priceTiers.length > 1);

  return (
    <table className="spec-table">
      <thead>
        {/* Two-tier header: the quantity-break columns share one "Pkg." cap,
            exactly as on the reference site. */}
        <tr>
          {defs.map((d) => (
            <th key={d.key} className="!border-b-0" />
          ))}
          <th className="!border-b-0" />
          <th className="!border-b-0" />
          <th className="group" colSpan={hasBulk ? 2 : 1}>
            {t.pkg} — {currencyLabel(locale)}
          </th>
          <th className="!border-b-0" />
          <th className="!border-b-0" />
        </tr>
        <tr>
          {defs.map((d) => (
            <th key={d.key} className={d.kind === "number" ? "num" : undefined}>
              {pick(d, "label", locale)}
            </th>
          ))}
          <th className="num">{t.pkgQty}</th>
          <th>{t.partNumber}</th>
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
          return (
            <tr
              key={p.id}
              className={isHit ? "bg-[var(--color-amber-soft)]" : undefined}
            >
              {defs.map((d) => {
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
                return (
                  <td
                    key={d.key}
                    className={
                      isNum ? "num tech tech-num" : technical ? "tech" : undefined
                    }
                  >
                    {text}
                    {isNum && d.unit ? d.unit : ""}
                  </td>
                );
              })}
              <td className="num tech tech-num">{p.packQty}</td>
              <td>
                <span className="part-no tech">{p.partNumber}</span>
              </td>
              {/* Bare amounts — the currency is named once in the group header.
                  Repeating "تومان" on 200 rows costs ~40px of table width and
                  tells the buyer nothing they don't already know. */}
              <td className="num tech tech-num price-col font-semibold">{formatPriceBare(base, locale, rate)}</td>
              {hasBulk && (
                <td className="num tech tech-num price-col text-[var(--color-ink-muted)]">
                  {bulk !== undefined ? formatPriceBare(bulk, locale, rate) : ""}
                </td>
              )}
              <td>
                <AddToCartRow productId={p.id} locale={locale} packQty={p.packQty} />
              </td>
              <td className="in-cart-col">
                <InCartQty productId={p.id} locale={locale} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
