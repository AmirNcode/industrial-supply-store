"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  cellText,
  productTableColumns,
  type CellId,
  type ProductColumn,
  type ProductRecord,
} from "@/lib/productTable";
import { FamilyImportControl } from "../FamilyImportControl";
import { cellKey } from "../productDrafts";
import { nodeName } from "../taxonomyText";
import { EditDetails } from "./EditDetails";
import { NavRow, NodeHeader } from "./MobileBrowse";
import { backTarget, type MobileShared } from "./MobileWorkbench";
import { Banner, ChevronForward, Magnifier, SectionHeading, TopBar, ChevronBack, ToggleRow } from "./parts";
import { MOBILE_PAGE_SIZE, useFamilyProducts } from "./useFamilyProducts";

type FamilyProps = MobileShared & {
  node: AdminTaxonomyNode;
  view: "page" | "product" | "details";
  productPart: string | null;
};

/**
 * A family's screens: its page (import, + Add a product, the product list),
 * one of its products, and its details.
 *
 * One component for all three, keyed by the family, so the product edits
 * outlive the moves between them — list, product, list — and go only when the
 * family does. That is the desktop's `key={selected.key}` rule, kept.
 */
export function MobileFamily(props: FamilyProps) {
  const { node, locale, view } = props;
  const products = useFamilyProducts({
    familyId: node.id,
    locale,
    refreshKey: props.nodes,
    onPendingChange: props.onProductPending,
    handleRef: props.productTable,
  });

  // A success banner goes after a few seconds, or at the next edit.
  const { notice, setNotice, changed } = products;
  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);
  const lastChanged = useRef(changed);
  // Where the list was scrolled, for the way back from a product. Kept here,
  // above the list, because the list itself is gone while a product shows.
  const listScrollRef = useRef(0);
  useEffect(() => {
    // Only a new edit: a Save that lands also changes the count, to zero.
    if (changed > lastChanged.current && notice?.kind === "ok") setNotice(null);
    lastChanged.current = changed;
  }, [changed, notice, setNotice]);

  if (view === "details") {
    return <EditDetails {...props} onCancel={() => props.goBack({ cat: node.key })} />;
  }
  if (view === "product" && props.productPart) {
    return <ProductEditor {...props} part={props.productPart} products={products} />;
  }
  return <FamilyPage {...props} products={products} listScrollRef={listScrollRef} />;
}

type Products = ReturnType<typeof useFamilyProducts>;

function FamilyPage(
  props: FamilyProps & { products: Products; listScrollRef: React.RefObject<number> },
) {
  const { node, locale, demo, products, listScrollRef } = props;
  const t = getDict(locale);
  const back = backTarget(node, props.categoriesById);
  const columns = useMemo(() => productTableColumns(products.defs), [products.defs]);
  const specColumns = columns.filter(
    (column): column is Extract<ProductColumn, { kind: "spec" }> => column.kind === "spec",
  );

  // Back from a product lands on the row it was opened from.
  useLayoutEffect(() => {
    if (listScrollRef.current > 0) window.scrollTo(0, listScrollRef.current);
    listScrollRef.current = 0;
  }, [listScrollRef]);

  // After a refused Save, bring the first refused row into view.
  const { scrollTarget, clearScrollTarget, rows } = products;
  useEffect(() => {
    if (!scrollTarget) return;
    const row = document.querySelector(`[data-part="${CSS.escape(scrollTarget)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    clearScrollTarget();
  }, [scrollTarget, clearScrollTarget, rows]);

  const invalidParts = new Map<string, number>();
  for (const key of products.invalid) {
    const part = key.slice(0, key.indexOf("\u0000"));
    invalidParts.set(part, (invalidParts.get(part) ?? 0) + 1);
  }

  const left = products.total - products.rows.length;
  const familyTotal = products.query ? node.productCount : products.total;

  function openProduct(part: string) {
    listScrollRef.current = window.scrollY;
    props.navigate({ cat: node.key, product: part }, { returnable: true });
  }

  return (
    <div className="mtx-screen is-family">
      <NavRow
        locale={locale}
        backLabel={back?.parent ? nodeName(back.parent, locale) : t.taxonomyAllCategories}
        onBack={() => back && props.navigate(back.route)}
        onJump={props.openJump}
      />
      <NodeHeader {...props} node={node} />

      <div className="mtx-banners">
        {props.banners}
        <ProductNotice products={products} locale={locale} />
      </div>

      <section className="mtx-section mtx-import">
        <SectionHeading
          count={node.productCount > 0 ? t.taxonomyImportUnknown : t.taxonomyNeverImported}
        >
          {t.taxonomyCatalogImport}
        </SectionHeading>
        <FamilyImportControl
          familyId={node.id}
          familyName={nodeName(node, locale)}
          locale={locale}
          demo={demo}
          variant="mobile"
          extras={
            <div className="mtx-chips mtx-import-chips">
              <a className="mtx-chip" href={`/api/admin/family/${node.id}/template`} download>
                {t.downloadTemplate}
              </a>
              <a className="mtx-chip" href={`/api/admin/family/${node.id}/export`} download>
                {t.exportProducts}
              </a>
              <Link className="mtx-chip" href={`/${locale}/admin/products/${node.id}/columns`}>
                {t.editColumns}
              </Link>
            </div>
          }
        />
      </section>

      <div className="mtx-add-product-wrap">
        {demo ? (
          <button type="button" className="mtx-add-product" disabled>
            + {t.newProduct}
          </button>
        ) : (
          <Link className="mtx-add-product" href={`/${locale}/admin/products/${node.id}/new`}>
            + {t.newProduct}
          </Link>
        )}
      </div>

      <section className="mtx-list mtx-products">
        <SectionHeading count={formatInt(familyTotal, locale)}>{t.products}</SectionHeading>
        <div className="mtx-product-search">
          <Magnifier />
          <input
            type="search"
            value={products.input}
            placeholder={t.mobileFindPart}
            aria-label={t.mobileFindPart}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(event) => products.setInput(event.target.value)}
          />
        </div>

        {products.status === "failed" ? (
          <div className="mtx-list-banner">
            <Banner tone="error">
              {t.productsLoadFailed}
              <button type="button" className="mtx-button mtx-ghost mtx-secondary" onClick={products.retry}>
                {t.mobileRetry}
              </button>
            </Banner>
          </div>
        ) : products.status === "loading" ? (
          <p className="mtx-list-note">{t.productsLoading}</p>
        ) : products.total === 0 ? (
          <p className="mtx-list-note">{products.query ? t.mobileNoProductsMatch : t.productsEmpty}</p>
        ) : (
          <ul className={products.searching ? "is-stale" : undefined}>
            {products.rows.map((product) => (
              <ProductRow
                key={product.partNumber}
                product={product}
                edits={products.draft[product.partNumber]}
                toFix={invalidParts.get(product.partNumber) ?? 0}
                specColumns={specColumns}
                locale={locale}
                onOpen={() => openProduct(product.partNumber)}
              />
            ))}
          </ul>
        )}

        {products.status === "ready" && left > 0 && (
          <div className="mtx-show-more">
            <button
              type="button"
              className="mtx-button mtx-ghost mtx-secondary"
              disabled={products.loadingMore}
              onClick={products.showMore}
            >
              {products.loadingMore
                ? t.productsLoading
                : t.mobileShowMore
                    .replace("{n}", formatInt(Math.min(MOBILE_PAGE_SIZE, left), locale))
                    .replace("{left}", formatInt(left, locale))}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ProductRow({
  product,
  edits,
  toFix,
  specColumns,
  locale,
  onOpen,
}: {
  product: ProductRecord;
  edits: Partial<Record<CellId, string>> | undefined;
  toFix: number;
  specColumns: Extract<ProductColumn, { kind: "spec" }>[];
  locale: Locale;
  onOpen: () => void;
}) {
  const t = getDict(locale);
  const value = (cell: CellId) => edits?.[cell] ?? cellText(product, cell);
  const specs = specColumns
    .slice(0, 2)
    .map((column) => value(column.id))
    .filter(Boolean)
    .join(" · ");
  const qty = value("qty");
  const inStock = value("inStock") === "yes";
  return (
    <li>
      <button
        type="button"
        data-part={product.partNumber}
        className={`mtx-product-row ${toFix > 0 ? "is-invalid" : edits ? "is-edited" : ""}`}
        onClick={onOpen}
      >
        <span className="mtx-product-main">
          <span className="mtx-product-part">
            <span className="mtx-part" dir="ltr">{product.partNumber}</span>
            {toFix > 0 ? (
              <span className="mtx-tag is-danger">
                {t.mobileToFix.replace("{n}", formatInt(toFix, locale))}
              </span>
            ) : edits ? (
              <span className="mtx-tag">{t.mobileEdited}</span>
            ) : null}
          </span>
          {specs && <span className="mtx-product-specs" dir="ltr">{specs}</span>}
        </span>
        <span className="mtx-product-stock">
          <span className="mtx-product-avail">
            <b className="mtx-mono">{/^\d+$/.test(qty) ? formatInt(Number(qty), locale) : qty}</b>{" "}
            {t.mobileAvail}
          </span>
          <span className={`mtx-stock-flag ${inStock ? "is-in" : ""}`}>
            {inStock ? t.inStock : t.mobileOut}
          </span>
        </span>
        <ChevronForward />
      </button>
    </li>
  );
}

/** The products' own Save outcome, as the family page shows it. */
function ProductNotice({ products, locale }: { products: Products; locale: Locale }) {
  const t = getDict(locale);
  const { notice, invalid } = products;
  if (!notice) return null;
  if (notice.kind === "ok") return <Banner tone="ok">{notice.text}</Banner>;
  if (notice.kind === "stale") return <Banner tone="warn">{notice.text}</Banner>;
  if (notice.kind === "invalid") {
    const parts = new Set([...invalid].map((key) => key.slice(0, key.indexOf("\u0000"))));
    if (parts.size === 1) {
      return (
        <Banner tone="error">
          {t.mobileInvalidRow
            .replace("{n}", formatInt(invalid.size, locale))
            .replace("{part}", [...parts][0])}
        </Banner>
      );
    }
  }
  return <Banner tone="error">{notice.text}</Banner>;
}

/** What a refused cell should be told, by what kind of value it holds. */
function fixMessage(column: ProductColumn, t: ReturnType<typeof getDict>): string {
  if (column.kind === "spec") {
    return column.def.kind === "number" ? t.mobileBadNumber : t.mobileBadValue;
  }
  if (column.kind !== "field") return t.mobileBadValue;
  if (column.field === "price") return t.mobileBadNumber;
  if (column.field === "qty" || column.field === "packQty" || column.field === "leadDays") {
    return t.mobileBadWhole;
  }
  if (column.field === "imageUrl") return t.newProductBadImage;
  return t.mobileBadValue;
}

/**
 * One product's fields. No Save of its own: every change joins the page's
 * pending bar, and ‹ Products goes back to the list with the row marked.
 * The fields are the table's columns (`productTableColumns`), so a family's
 * own columns appear here without any code knowing what they are.
 */
function ProductEditor(props: FamilyProps & { part: string; products: Products }) {
  const { node, locale, demo, products, part } = props;
  const t = getDict(locale);
  const product =
    products.rows.find((row) => row.partNumber === part) ?? products.known.get(part)?.product;
  const columns = useMemo(() => productTableColumns(products.defs), [products.defs]);

  const { ensureProduct, status } = products;
  useEffect(() => {
    if (!product && status !== "loading") ensureProduct(part);
  }, [product, status, part, ensureProduct]);

  const back = () => props.goBack({ cat: node.key });
  const top = (
    <TopBar
      start={
        <button type="button" className="mtx-back" onClick={back}>
          <ChevronBack />
          <span>{t.products}</span>
        </button>
      }
      title={<span dir="ltr">{part}</span>}
      kind={t.mobileInFamily.replace("{family}", nodeName(node, locale))}
    />
  );

  if (!product) {
    return (
      <div className="mtx-screen is-form">
        {top}
        <p className="mtx-list-note">
          {products.lookup?.state === "missing" ? t.mobileNoProductsMatch : t.productsLoading}
        </p>
      </div>
    );
  }

  const edits = products.draft[part];
  const problems = columns.filter(
    (column) =>
      (column.kind === "spec" || column.kind === "field") &&
      products.invalid.has(cellKey(part, column.id)),
  ).length;
  const label = (column: ProductColumn): { name: string; unit?: string } => {
    if (column.kind === "spec") {
      const name = locale === "fa" ? column.def.labelFa || column.def.labelEn : column.def.labelEn;
      return { name, unit: column.def.unit || undefined };
    }
    if (column.kind === "readonly") {
      return { name: column.field === "onHold" ? t.stockOnHold : t.stockSold };
    }
    if (column.kind === "part") return { name: t.partNumber };
    return {
      qty: { name: t.productsQty },
      price: { name: t.price, unit: "USD" },
      packQty: { name: t.packQty },
      leadDays: { name: t.leadTime },
      inStock: { name: t.inStock },
      imageUrl: { name: t.newProductImage },
    }[column.field];
  };

  const field = (column: ProductColumn) => {
    if (column.kind !== "spec" && column.kind !== "field") return null;
    const id = column.id;
    const value = edits?.[id] ?? cellText(product, id);
    const edited = edits?.[id] !== undefined;
    const bad = products.invalid.has(cellKey(part, id));
    const { name, unit } = label(column);
    if (id === "inStock") {
      return (
        <div key={id} className={`mtx-field ${bad ? "is-invalid" : ""}`}>
          <ToggleRow
            label={
              <>
                {name}
                {edited && <span className="mtx-tag">{t.mobileEdited}</span>}
              </>
            }
            checked={value === "yes"}
            disabled={demo}
            onChange={(checked) => products.change(product, id, checked ? "yes" : "no")}
          />
        </div>
      );
    }
    const numeric =
      column.kind === "spec"
        ? column.def.kind === "number"
          ? "decimal"
          : undefined
        : id === "price"
          ? "decimal"
          : id === "imageUrl"
            ? "url"
            : "numeric";
    const inputId = `mtx-cell-${id}`;
    return (
      <div key={id} className="mtx-field">
        {/* The label is the name alone: unit and tag sit beside it, so the
            field is announced — and found — by its name. */}
        <div className="mtx-field-label">
          <label htmlFor={inputId}>{name}</label>
          {unit && <span className="mtx-field-unit">({unit})</span>}
          {bad ? null : edited && <span className="mtx-tag">{t.mobileEdited}</span>}
        </div>
        <input
          id={inputId}
          type="text"
          dir="ltr"
          className={`mtx-input ${bad ? "is-invalid" : edited ? "is-edited" : ""} ${column.kind === "field" && id !== "imageUrl" ? "mtx-mono" : ""}`}
          inputMode={numeric}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${inputId}-error` : undefined}
          onChange={(event) => products.change(product, id, event.target.value)}
        />
        {bad && (
          <span id={`${inputId}-error`} className="mtx-field-error">
            {fixMessage(column, t)}
          </span>
        )}
      </div>
    );
  };

  const specs = columns.filter((column) => column.kind === "spec");
  const commercialOrder: CellId[] = ["price", "packQty", "leadDays", "qty", "inStock", "imageUrl"];
  const commercial = commercialOrder
    .map((id) => columns.find((column) => column.kind === "field" && column.id === id))
    .filter((column): column is ProductColumn => Boolean(column));

  return (
    <div className="mtx-screen is-form">
      {top}
      <div className="mtx-banners">
        {props.banners}
        {problems > 0 && (
          <Banner tone="error">
            {problems === 1
              ? t.mobileFixHereOne
              : t.mobileFixHereMany.replace("{n}", formatInt(problems, locale))}
          </Banner>
        )}
        {products.notice && products.notice.kind !== "invalid" && (
          <ProductNotice products={products} locale={locale} />
        )}
      </div>
      <fieldset className="mtx-fieldset" disabled={demo}>
        {specs.length > 0 && (
          <section className="mtx-section">
            <SectionHeading>{t.newProductSpecs}</SectionHeading>
            <div className="mtx-fields">{specs.map(field)}</div>
          </section>
        )}
        <section className="mtx-section">
          <SectionHeading>{t.newProductCommercial}</SectionHeading>
          <div className="mtx-fields">{commercial.map(field)}</div>
        </section>
        <section className="mtx-section">
          <SectionHeading>{t.mobileStock}</SectionHeading>
          <div className="mtx-pair">
            {(["onHold", "sold"] as const).map((readonly) => (
              <label key={readonly} className="mtx-field">
                <span className="mtx-field-label">
                  {readonly === "onHold" ? t.stockOnHold : t.stockSold}
                </span>
                <input
                  type="text"
                  readOnly
                  dir="ltr"
                  className="mtx-input mtx-mono"
                  value={formatInt(Number(cellText(product, readonly)), locale)}
                />
              </label>
            ))}
          </div>
          <p className="mtx-hint mtx-stock-note">{t.mobileStockReadOnly}</p>
        </section>
      </fieldset>
    </div>
  );
}
