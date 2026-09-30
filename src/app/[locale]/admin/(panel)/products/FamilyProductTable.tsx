"use client";

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { FamilyProductsResponse } from "@/app/api/admin/family/[id]/products/route";
import {
  PRODUCT_PAGE_SIZE,
  cellText,
  productFingerprint,
  productTableColumns,
  type CellId,
  type ProductColumn,
  type ProductRecord,
} from "@/lib/productTable";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { saveFamilyProductsAction } from "./productTableActions";

/** Enough rows to scan and edit; few enough that edit mode stays quick. */
const PAGE_SIZE = PRODUCT_PAGE_SIZE;

/** What the workbench's leave-the-page guard needs from this table. */
export type ProductTableHandle = { save: () => Promise<boolean>; discard: () => void };

type Draft = Record<string, Partial<Record<CellId, string>>>;
type Notice = { kind: "ok" | "error"; text: string };

const cellKey = (partNumber: string, cell: CellId) => `${partNumber}\u0000${cell}`;

/**
 * A family's products, readable at a glance and editable in place.
 *
 * Follows the admin editing rules in docs/ARCHITECTURE.md. Typing changes
 * local state only, and Save writes every edited row in one action. A cell
 * counts as edited only while it differs from what was loaded, so typing a
 * value back clears it. Every cell must pass before anything is written. The
 * workbench's guard covers leaving the page with edits unsaved, including
 * picking another family in the tree.
 *
 * The rows are fetched by this component, not rendered with the page: the
 * workbench switches family without a server round trip. One page at a time
 * (review M-21); every row loaded so far is remembered in `known`, so an edit
 * made on page 3 can still be saved — with the fingerprint it was loaded
 * with — from page 7.
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
  const router = useRouter();
  const [data, setData] = useState<FamilyProductsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Every row loaded so far in this family, with its position, by part number.
  const [known, setKnown] = useState<ReadonlyMap<string, { product: ProductRecord; index: number }>>(
    () => new Map(),
  );

  // Another family, or a refresh after an import: nothing loaded still holds.
  const [loadedFor, setLoadedFor] = useState({ familyId, refreshKey });
  if (loadedFor.familyId !== familyId || loadedFor.refreshKey !== refreshKey) {
    setLoadedFor({ familyId, refreshKey });
    setKnown(new Map());
    setPage(0);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/family/${familyId}/products?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: FamilyProductsResponse) => {
        setData(body);
        setKnown((previous) => {
          const next = new Map(previous);
          body.products.forEach((product, i) =>
            next.set(product.partNumber, { product, index: body.page * PAGE_SIZE + i }),
          );
          return next;
        });
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [familyId, refreshKey, reloadToken, page]);

  const columns = useMemo(() => productTableColumns(data?.defs ?? []), [data]);
  const changed = Object.keys(draft).length;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const rows = data?.products ?? [];

  useEffect(() => {
    onPendingChange(changed);
  }, [changed, onPendingChange]);
  useEffect(() => () => onPendingChange(0), [onPendingChange]);

  function change(product: ProductRecord, cell: CellId, value: string) {
    setDraft((previous) => {
      const row = { ...previous[product.partNumber] };
      if (value === cellText(product, cell)) delete row[cell];
      else row[cell] = value;
      const next = { ...previous };
      if (Object.keys(row).length === 0) delete next[product.partNumber];
      else next[product.partNumber] = row;
      return next;
    });
    const key = cellKey(product.partNumber, cell);
    if (invalid.has(key)) {
      setInvalid((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

  function discard() {
    setDraft({});
    setInvalid(new Set());
    setEditing(false);
    setNotice(null);
  }

  async function save(): Promise<boolean> {
    if (saving || !data) return false;
    if (changed === 0) {
      setEditing(false);
      return true;
    }
    setSaving(true);
    setNotice(null);
    const payload = Object.entries(draft).flatMap(([partNumber, edits]) => {
      const product = known.get(partNumber)?.product;
      return product ? [{ partNumber, fingerprint: productFingerprint(product), edits }] : [];
    });
    try {
      const result = await saveFamilyProductsAction(familyId, payload);
      if (result.kind === "saved") {
        // The stored rows replace the edited ones in the same render as the
        // draft clears, so the table never flashes the old values.
        const fresh = new Map(result.products.map((product) => [product.partNumber, product]));
        setData((previous) =>
          previous && {
            ...previous,
            products: previous.products.map((product) => fresh.get(product.partNumber) ?? product),
          },
        );
        setKnown((previous) => {
          const next = new Map(previous);
          for (const [partNumber, product] of fresh) {
            const entry = next.get(partNumber);
            if (entry) next.set(partNumber, { ...entry, product });
          }
          return next;
        });
        setDraft({});
        setInvalid(new Set());
        setEditing(false);
        setNotice({ kind: "ok", text: t.productsSaved.replace("{n}", formatInt(result.count, locale)) });
        // The tree's stock counts; `refreshKey` then reloads these rows too.
        router.refresh();
        return true;
      }
      if (result.kind === "invalid") {
        setInvalid(new Set(result.cells.map(({ partNumber, cell }) => cellKey(partNumber, cell))));
        const first = known.get(result.cells[0]?.partNumber ?? "")?.index ?? -1;
        if (first >= 0) setPage(Math.floor(first / PAGE_SIZE));
        setNotice({
          kind: "error",
          text: t.productsInvalid.replace("{n}", formatInt(result.cells.length, locale)),
        });
      } else if (result.kind === "stale") {
        // Fresh rows under the same edits: the person checks, then saves again.
        setReloadToken((token) => token + 1);
        setNotice({
          kind: "error",
          text: t.productsStale.replace("{n}", formatInt(result.partNumbers.length, locale)),
        });
      } else {
        setNotice({ kind: "error", text: t.productsSaveFailed });
      }
      return false;
    } catch {
      setNotice({ kind: "error", text: t.productsSaveFailed });
      return false;
    } finally {
      setSaving(false);
    }
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
