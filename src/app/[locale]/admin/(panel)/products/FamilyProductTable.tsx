"use client";

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { FamilyProductsResponse } from "@/app/api/admin/family/[id]/products/route";
import {
  PRODUCT_PAGE_SIZE,
  cellText,
  productTableColumns,
  type ProductColumn,
} from "@/lib/productTable";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { cellKey, useProductDrafts, type ProductTableHandle } from "./productDrafts";

/** Enough rows to scan and edit; few enough that edit mode stays quick. */
const PAGE_SIZE = PRODUCT_PAGE_SIZE;

export type { ProductTableHandle };

/**
 * A family's products, readable at a glance and editable in place.
 *
 * Follows the admin editing rules in docs/ARCHITECTURE.md. Typing changes
 * local state only, and Save writes every edited row in one action; the
 * drafts and that Save live in `useProductDrafts`, shared with the phone's
 * product list. The workbench's guard covers leaving the page with edits
 * unsaved, including picking another family in the tree.
 *
 * The rows are fetched by this component, not rendered with the page: the
 * workbench switches family without a server round trip. One page at a time
 * (review M-21); every row loaded so far is remembered, so an edit made on
 * page 3 can still be saved — with the fingerprint it was loaded with — from
 * page 7.
 */
export function FamilyProductTable({
  familyId,
  locale,
  demo,
  toolbar,
  refreshKey,
  handleRef,
  onPendingChange,
}: {
  familyId: number;
  locale: Locale;
  demo: boolean;
  /** The import row's own controls; Edit, Save and Discard join them. */
  toolbar: ReactNode;
  /** Changes whenever the page's data is refreshed, e.g. after an import. */
  refreshKey: unknown;
  handleRef: RefObject<ProductTableHandle | null>;
  onPendingChange: (changedProducts: number) => void;
}) {
  const t = getDict(locale);
  const [data, setData] = useState<FamilyProductsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const drafts = useProductDrafts({
    familyId,
    locale,
    onPendingChange,
    onSaved: (fresh) =>
      setData((previous) =>
        previous && {
          ...previous,
          products: previous.products.map((product) => fresh.get(product.partNumber) ?? product),
        },
      ),
    onInvalid: ({ index }) => {
      if (index !== undefined) setPage(Math.floor(index / PAGE_SIZE));
    },
    onStale: () => setReloadToken((token) => token + 1),
  });
  const { draft, invalid, saving, notice, setNotice, changed, change } = drafts;

  // Another family, or a refresh after an import: nothing loaded still holds.
  const [loadedFor, setLoadedFor] = useState({ familyId, refreshKey });
  if (loadedFor.familyId !== familyId || loadedFor.refreshKey !== refreshKey) {
    setLoadedFor({ familyId, refreshKey });
    drafts.forget();
    setPage(0);
  }

  const remember = drafts.remember;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/family/${familyId}/products?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: FamilyProductsResponse) => {
        setData(body);
        remember(body.products, body.page * PAGE_SIZE);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
    // `remember` only calls a state setter; listing it would refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, refreshKey, reloadToken, page]);

  const columns = useMemo(() => productTableColumns(data?.defs ?? []), [data]);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const rows = data?.products ?? [];

  function discard() {
    drafts.discard();
    setEditing(false);
  }

  async function save(): Promise<boolean> {
    if (saving || !data) return false;
    const ok = await drafts.save();
    if (ok) setEditing(false);
    return ok;
  }

  // The guard reads these when someone leaves with edits unsaved.
  useEffect(() => {
    handleRef.current = { save, discard };
  });
  useEffect(() => () => {
    handleRef.current = null;
  }, [handleRef]);

  const label = (column: ProductColumn): string => {
    if (column.kind === "part") return t.partNumber;
    if (column.kind === "spec") {
      const name = locale === "fa" ? column.def.labelFa || column.def.labelEn : column.def.labelEn;
      return column.def.unit ? `${name} (${column.def.unit})` : name;
    }
    return {
      qty: t.productsQty,
      price: t.productsPriceUsd,
      packQty: t.packQty,
      leadDays: t.leadTime,
      inStock: t.inStock,
      imageUrl: t.newProductImage,
      onHold: t.stockOnHold,
      sold: t.stockSold,
    }[column.field];
  };

  return (
    <>
      <div className="taxonomy-selected-import">
        {toolbar}
        <span className="product-table-actions">
          {editing ? (
            <>
              <button type="button" className="taxonomy-ghost-button" disabled={saving} onClick={discard}>
                {t.orderDiscard}
              </button>
              <button
                type="button"
                className="taxonomy-primary-button"
                disabled={demo || saving || changed === 0}
                onClick={save}
              >
                {saving ? t.productsSaving : t.productsSave}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="taxonomy-ghost-button"
              disabled={demo || !data || data.total === 0}
              onClick={() => {
                setEditing(true);
                setNotice(null);
              }}
            >
              {t.productsEdit}
            </button>
          )}
        </span>
      </div>

      {notice && (
        <p className={notice.kind === "ok" ? "taxonomy-success-banner" : "taxonomy-error-banner"}>
          {notice.text}
        </p>
      )}

      <div className="product-table-head">
        <span className="tech">
          {data ? t.productsCount.replace("{n}", formatInt(data.total, locale)) : ""}
        </span>
        {changed > 0 && (
          <strong className="product-table-pending">
            {t.productsPending.replace("{n}", formatInt(changed, locale))}
          </strong>
        )}
        {pages > 1 && (
          <span className="product-table-pager">
            <button
              type="button"
              className="taxonomy-ghost-button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t.productsPrevious}
            </button>
            <span className="tech">
              {t.productsPage
                .replace("{page}", formatInt(currentPage + 1, locale))
                .replace("{pages}", formatInt(pages, locale))}
            </span>
            <button
              type="button"
              className="taxonomy-ghost-button"
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              {t.productsNext}
            </button>
          </span>
        )}
      </div>

      {failed && !data ? (
        <p className="taxonomy-error-banner">{t.productsLoadFailed}</p>
      ) : !data ? (
        <p className="product-table-empty">{t.productsLoading}</p>
      ) : data.total === 0 ? (
        <p className="product-table-empty">{t.productsEmpty}</p>
      ) : (
        // Scrolls both ways inside its own box, so the horizontal scrollbar and
        // the sticky header stay on screen however long the page is.
        <div className="product-table-scroll" role="region" aria-label={t.productsTableLabel} tabIndex={0}>
          <table className={`product-table ${editing ? "is-editing" : ""}`}>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={index} scope="col" className={columnClass(column)}>
                    {label(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const edits = draft[product.partNumber];
                return (
                  <tr key={product.partNumber} className={edits ? "is-changed" : undefined}>
                    {columns.map((column, index) => {
                      if (column.kind === "part") {
                        return (
                          <th key={index} scope="row" className="product-table-part tech">
                            {product.partNumber}
                          </th>
                        );
                      }
                      if (column.kind === "readonly") {
                        return (
                          <td key={index} className="num tech product-table-readonly">
                            {cellText(product, column.field)}
                          </td>
                        );
                      }
                      const id = column.id;
                      const value = edits?.[id] ?? cellText(product, id);
                      const state = `${edits?.[id] !== undefined ? "is-dirty" : ""} ${
                        invalid.has(cellKey(product.partNumber, id)) ? "is-invalid" : ""
                      }`;
                      if (!editing) {
                        return (
                          <td key={index} className={`${columnClass(column)} ${state}`}>
                            {id === "inStock" ? (value === "yes" ? t.productsYes : t.productsNo) : value}
                          </td>
                        );
                      }
                      const name = `${label(column)} — ${product.partNumber}`;
                      return (
                        <td key={index} className={`${columnClass(column)} ${state}`}>
                          {id === "inStock" ? (
                            <input
                              type="checkbox"
                              aria-label={name}
                              checked={value === "yes"}
                              onChange={(event) => change(product, id, event.target.checked ? "yes" : "no")}
                            />
                          ) : (
                            <input
                              type="text"
                              dir="ltr"
                              aria-label={name}
                              aria-invalid={invalid.has(cellKey(product.partNumber, id)) || undefined}
                              className="product-cell-input"
                              // Wide enough for what it holds, so editing does
                              // not hide text the view showed in full.
                              size={Math.min(60, Math.max(6, value.length + 1))}
                              value={value}
                              onChange={(event) => change(product, id, event.target.value)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Numbers right-aligned; long text given room. */
function columnClass(column: ProductColumn): string {
  if (column.kind === "part") return "product-table-part";
  if (column.kind === "readonly") return "num";
  if (column.kind === "spec") return column.def.kind === "number" ? "num tech" : "product-table-text";
  if (column.field === "imageUrl") return "product-table-url tech";
  if (column.field === "inStock") return "product-table-flag";
  return "num tech";
}
