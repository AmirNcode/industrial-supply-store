"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { FamilyProductsResponse } from "@/app/api/admin/family/[id]/products/route";
import {
  BLANK_PRODUCT,
  PRODUCT_PAGE_SIZE,
  cellText,
  newRowHasContent,
  productTableColumns,
  type ProductColumn,
} from "@/lib/productTable";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { useModalFocus } from "@/lib/useModalFocus";
import {
  cellKey,
  newCellKey,
  useProductDrafts,
  type NewRow,
  type NewRowDraft,
  type ProductTableHandle,
} from "./productDrafts";
import { countOpenOrderProductsAction, deleteFamilyProductsAction } from "./productTableActions";

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
 *
 * Edit mode also ends in blank rows for new products — the table's
 * replacement for the old "Add a product" page. Their part number cell reads
 * "New" and the number is issued on Save, with the edits, in one write. The
 * phone keeps its own add screen; a row this wide does not fit one.
 *
 * Any row, loaded or new, can be copied into a new row at the bottom, the
 * cursor landing in its first column, which is usually what differs (size,
 * class, dash number). Everything is copied but stock, which is an actual
 * count for that item; the empty stock cell is highlighted until it is filled.
 *
 * Deleting rows is a separate mode from editing, and the two never overlap:
 * a row deleted while it held an unsaved edit would leave a draft Save could
 * only fail on. Ticks are kept by part number, so they survive paging, and
 * nothing is deleted until the dialog listing every ticked part number is
 * confirmed.
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
  const router = useRouter();
  // Null while not choosing rows to delete; the ticked part numbers otherwise.
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Null until known; the dialog does not wait for it.
  const [onOpenOrders, setOnOpenOrders] = useState<number | null>(null);
  // Only the latest opening's answer counts; an earlier one may land late.
  const openOrdersAsk = useRef(0);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  const deleteDialog = useRef<HTMLDivElement>(null);
  useModalFocus(confirming, deleteDialog, deleteOpener, () => {
    if (!deleting) setConfirming(false);
  });
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
  const { draft, newRows, nextNewId, sameAs, invalid, saving, notice, setNotice, changed, change, changeNew } =
    drafts;
  // Always one blank row after the last filled one, so the next product has
  // somewhere to go without a button. Its key is the id it will take, so the
  // input being typed in survives becoming a real row.
  const blankRow: NewRow | null =
    newRows.length === 0 || newRowHasContent(newRows[newRows.length - 1].cells)
      ? { id: nextNewId, cells: {} }
      : null;
  const shownNewRows = blankRow ? [...newRows, blankRow] : newRows;

  // A copy's first column takes the cursor once the copy has rendered.
  const focusNewRow = useRef<number | null>(null);
  useEffect(() => {
    if (focusNewRow.current === null) return;
    const input = document.querySelector<HTMLInputElement>(`[data-new-row-first="${focusNewRow.current}"]`);
    focusNewRow.current = null;
    input?.focus();
  });

  // Another family, or a refresh after an import: nothing loaded still holds.
  const [loadedFor, setLoadedFor] = useState({ familyId, refreshKey });
  if (loadedFor.familyId !== familyId || loadedFor.refreshKey !== refreshKey) {
    setLoadedFor({ familyId, refreshKey });
    drafts.forget();
    setPage(0);
    setSelected(null);
    setConfirming(false);
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

  /** Every editable cell of a row except stock, as text, blanks left out. */
  function copyCells(valueOf: (column: EditableColumn) => string): NewRowDraft {
    const cells: NewRowDraft = {};
    for (const column of columns) {
      if (column.kind !== "spec" && column.kind !== "field") continue;
      if (column.id === "qty") continue;
      const value = valueOf(column);
      if (value !== "") cells[column.id] = value;
    }
    return cells;
  }

  function copyProduct(product: (typeof rows)[number]) {
    const edits = draft[product.partNumber];
    const cells = copyCells((column) => edits?.[column.id] ?? cellText(product, column.id));
    focusNewRow.current = drafts.addCopy(cells, {
      partNumber: product.partNumber,
      cells: columns.flatMap((column) => (column.kind === "spec" || column.kind === "field" ? [column.id] : [])),
    });
  }

  function copyNewRow(row: NewRow) {
    const cells = copyCells((column) => row.cells[column.id] ?? "");
    focusNewRow.current = drafts.addCopy(cells, { newId: row.id });
  }

  // The first spec column, or price in a family with none: where a copy differs.
  const firstCell = (columns.find((column) => column.kind === "spec") ??
    columns.find((column) => column.kind === "field" && column.field === "price")) as EditableColumn | undefined;

  function toggle(partNumbers: readonly string[], on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const partNumber of partNumbers) {
        if (on) next.add(partNumber);
        else next.delete(partNumber);
      }
      return next;
    });
  }

  async function deleteSelected() {
    if (deleting || !selected || selected.size === 0) return;
    setDeleting(true);
    setNotice(null);
    try {
      const result = await deleteFamilyProductsAction(familyId, [...selected]);
      if (result.kind === "deleted") {
        setSelected(null);
        setConfirming(false);
        setNotice({ kind: "ok", text: t.productsDeleted.replace("{n}", formatInt(result.count, locale)) });
        // The tree's counts; the new `refreshKey` then reloads these rows
        // from the first page, so no page is left pointing past the end.
        router.refresh();
      } else {
        setConfirming(false);
        setNotice({ kind: "error", text: t.productsDeleteFailed });
      }
    } catch {
      setConfirming(false);
      setNotice({ kind: "error", text: t.productsDeleteFailed });
    } finally {
      setDeleting(false);
    }
  }

  const pageParts = rows.map((product) => product.partNumber);
  const pageTicked = selected ? pageParts.filter((partNumber) => selected.has(partNumber)).length : 0;

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
              // Allowed on an empty family: its first product is added here.
              disabled={demo || !data || selected !== null}
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
      ) : data.total === 0 && !editing ? (
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
                    {selected && column.kind === "part" ? (
                      <label className="product-table-select">
                        <input
                          type="checkbox"
                          aria-label={t.productsSelectPage}
                          checked={pageTicked > 0 && pageTicked === pageParts.length}
                          ref={(box) => {
                            if (box) box.indeterminate = pageTicked > 0 && pageTicked < pageParts.length;
                          }}
                          onChange={(event) => toggle(pageParts, event.target.checked)}
                        />
                        {label(column)}
                      </label>
                    ) : (
                      label(column)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const edits = draft[product.partNumber];
                const ticked = selected?.has(product.partNumber) ?? false;
                return (
                  <tr
                    key={product.partNumber}
                    className={ticked ? "is-selected" : edits ? "is-changed" : undefined}
                  >
                    {columns.map((column, index) => {
                      if (column.kind === "part") {
                        return (
                          <th key={index} scope="row" className="product-table-part tech">
                            {selected ? (
                              <label className="product-table-select">
                                <input
                                  type="checkbox"
                                  aria-label={t.productsSelectRow.replace("{part}", product.partNumber)}
                                  checked={ticked}
                                  onChange={(event) => toggle([product.partNumber], event.target.checked)}
                                />
                                {product.partNumber}
                              </label>
                            ) : editing ? (
                              <span className="product-table-part-tools">
                                {product.partNumber}
                                <button
                                  type="button"
                                  className="product-row-button"
                                  aria-label={t.productsCopyRow.replace("{part}", product.partNumber)}
                                  onClick={() => copyProduct(product)}
                                >
                                  {t.productsCopy}
                                </button>
                              </span>
                            ) : (
                              product.partNumber
                            )}
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
              {editing &&
                shownNewRows.map((row, rowIndex) => {
                  const isBlank = row === blankRow;
                  const filled = newRowHasContent(row.cells);
                  const duplicateOf = sameAs.get(row.id);
                  const rowName = formatInt(rowIndex + 1, locale);
                  return (
                    <tr key={`new-${row.id}`} className={`is-new ${duplicateOf !== undefined ? "is-duplicate" : ""}`}>
                      {columns.map((column, index) => {
                        if (column.kind === "part") {
                          return (
                            <th key={index} scope="row" className="product-table-part product-table-new-part">
                              <span className="product-table-part-tools">
                                {duplicateOf === undefined
                                  ? t.productsNewRow
                                  : duplicateOf
                                    ? t.productsSameAs.replace("{part}", duplicateOf)
                                    : t.productsSameAsNew}
                                {!isBlank && (
                                  <>
                                    <button
                                      type="button"
                                      className="product-row-button"
                                      aria-label={t.productsCopyNewRow.replace("{n}", rowName)}
                                      onClick={() => copyNewRow(row)}
                                    >
                                      {t.productsCopy}
                                    </button>
                                    <button
                                      type="button"
                                      className="product-row-button"
                                      aria-label={t.productsRemoveNewRow.replace("{n}", rowName)}
                                      onClick={() => drafts.removeNew(row.id)}
                                    >
                                      {t.productsRemoveRow}
                                    </button>
                                  </>
                                )}
                              </span>
                            </th>
                          );
                        }
                        if (column.kind === "readonly") {
                          return <td key={index} className="num tech product-table-readonly" />;
                        }
                        const id = column.id;
                        const value = row.cells[id] ?? "";
                        const bad = invalid.has(newCellKey(row.id, id));
                        // A filled row with no stock yet: copies arrive like this on
                        // purpose, and the cell says so until a number goes in.
                        const needsStock = id === "qty" && filled && (value.trim() === "" || Number(value) === 0);
                        const name = `${label(column)} — ${t.productsNewRowLabel} ${rowName}`;
                        // What a blank cell becomes, shown faintly: no stock, a
                        // pack of one, no lead time. Price stays empty — blank is
                        // call-for-price, and "0.00" would read as free.
                        const fallback =
                          id === "qty" || id === "packQty" || id === "leadDays" ? cellText(BLANK_PRODUCT, id) : undefined;
                        const target = isBlank ? null : row.id;
                        return (
                          <td
                            key={index}
                            className={`${columnClass(column)} ${bad ? "is-invalid" : ""} ${needsStock ? "needs-attention" : ""}`}
                          >
                            {id === "inStock" ? (
                              <input
                                type="checkbox"
                                aria-label={name}
                                checked={(row.cells.inStock ?? "yes") === "yes"}
                                onChange={(event) => changeNew(target, id, event.target.checked ? "yes" : "no")}
                              />
                            ) : (
                              <input
                                type="text"
                                dir="ltr"
                                aria-label={name}
                                aria-invalid={bad || undefined}
                                title={needsStock ? t.productsEnterStock : undefined}
                                className="product-cell-input"
                                placeholder={fallback}
                                data-new-row-first={column === firstCell ? row.id : undefined}
                                size={Math.min(60, Math.max(6, value.length + 1))}
                                value={value}
                                onChange={(event) => changeNew(target, id, event.target.value)}
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

      {data && data.total > 0 && (
        <div className="product-table-foot">
          {selected === null ? (
            <button
              type="button"
              className="taxonomy-ghost-button"
              disabled={demo || editing}
              onClick={() => {
                setSelected(new Set());
                setNotice(null);
              }}
            >
              {t.productsSelectToDelete}
            </button>
          ) : (
            <>
              <button
                ref={deleteOpener}
                type="button"
                className="taxonomy-danger-button"
                disabled={demo || selected.size === 0}
                onClick={() => {
                  setConfirming(true);
                  setOnOpenOrders(null);
                  const ask = ++openOrdersAsk.current;
                  countOpenOrderProductsAction(familyId, [...selected])
                    .then((n) => {
                      if (ask === openOrdersAsk.current) setOnOpenOrders(n);
                    })
                    .catch(() => {});
                }}
              >
                {t.reviewDelete}
              </button>
              <button type="button" className="taxonomy-ghost-button" onClick={() => setSelected(null)}>
                {t.productsSelectDiscard}
              </button>
              <span className="tech">
                {t.productsSelected.replace("{n}", formatInt(selected.size, locale))}
              </span>
            </>
          )}
        </div>
      )}

      {confirming && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          // A backdrop click is a Cancel, like Escape — but not mid-delete,
          // when closing would hide whether it worked.
          onClick={() => {
            if (!deleting) setConfirming(false);
          }}
        >
          <div
            ref={deleteDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="product-delete-title"
            aria-describedby="product-delete-warn"
            tabIndex={-1}
            className="product-delete-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="product-delete-title">
              {t.productsDeleteTitle.replace("{n}", formatInt(selected.size, locale))}
            </h2>
            <p id="product-delete-warn">{t.productsDeleteWarn}</p>
            <ul className="product-delete-list tech" dir="ltr">
              {[...selected].sort().map((partNumber) => (
                <li key={partNumber}>{partNumber}</li>
              ))}
            </ul>
            <p className="product-delete-note">{t.productsDeleteOrders}</p>
            {onOpenOrders !== null && onOpenOrders > 0 && (
              <p className="product-delete-warn">
                {t.productsDeleteOpenOrders.replace("{n}", formatInt(onOpenOrders, locale))}
              </p>
            )}
            <div className="product-delete-actions">
              <button
                data-dialog-initial-focus
                type="button"
                className="taxonomy-ghost-button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
              >
                {t.fxCancel}
              </button>
              <button
                type="button"
                className="taxonomy-danger-button"
                disabled={demo || deleting}
                onClick={deleteSelected}
              >
                {deleting ? t.productsDeleting : t.reviewDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type EditableColumn = Extract<ProductColumn, { kind: "spec" | "field" }>;

/** Numbers right-aligned; long text given room. */
function columnClass(column: ProductColumn): string {
  if (column.kind === "part") return "product-table-part";
  if (column.kind === "readonly") return "num";
  if (column.kind === "spec") return column.def.kind === "number" ? "num tech" : "product-table-text";
  if (column.field === "imageUrl") return "product-table-url tech";
  if (column.field === "inStock") return "product-table-flag";
  return "num tech";
}
