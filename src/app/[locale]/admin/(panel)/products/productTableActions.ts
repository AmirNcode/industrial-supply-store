"use server";

import { assertAdminWrite } from "@/lib/admin";
import { revalidateCatalogPages } from "@/lib/revalidateCatalog";
import { countProductsOnOpenOrders, deleteFamilyProducts } from "@/db/familyQueries";
import { getFamilyForImport, getProductsForExport, writeImport } from "@/db/importQueries";
import { PartNumberUnavailable } from "@/db/partNumberQueries";
import { applyProductEdits, type ProductEdits } from "@/lib/productEdits";
import {
  BLANK_PRODUCT,
  newRowHasContent,
  productFingerprint,
  type CellId,
  type ProductRecord,
} from "@/lib/productTable";
import { IMPORT_MAX_ROWS } from "@/lib/importLimits";
import type { ImportRow } from "@/lib/importCsv";

/** One edited row: which product, what it looked like when shown, what changed. */
export type ProductEditPayload = {
  partNumber: string;
  fingerprint: string;
  edits: ProductEdits;
}[];

/** A bad cell: in a loaded row by its part number, or in a new row by position. */
export type InvalidCell = { partNumber: string; cell: CellId } | { newRow: number; cell: CellId };

export type ProductTableSaveResult =
  /**
   * `products` are the edited rows as stored, so the table shows them at once;
   * `created` the part numbers issued to new rows, in the order they were sent.
   */
  | { kind: "saved"; count: number; products: ProductRecord[]; created: string[] }
  | { kind: "invalid"; cells: InvalidCell[] }
  | { kind: "stale"; partNumbers: string[] }
  | { kind: "error"; message: "not-found" | "bad-data" | "refused" };

/** New rows: cell text only, each with something in it. */
function isNewRows(value: unknown, room: number): value is ProductEdits[] {
  if (!Array.isArray(value) || value.length > room) return false;
  return value.every((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
    const cells = Object.values(row);
    return (
      cells.length <= 500 &&
      cells.every((cell) => typeof cell === "string") &&
      newRowHasContent(row as ProductEdits)
    );
  });
}

/** A Server Action receives whatever was posted, not what its type says. */
function isPayload(value: unknown): value is ProductEditPayload {
  if (!Array.isArray(value) || value.length > IMPORT_MAX_ROWS) return false;
  const seen = new Set<string>();
  for (const row of value) {
    if (typeof row !== "object" || row === null) return false;
    const { partNumber, fingerprint, edits } = row as Record<string, unknown>;
    if (typeof partNumber !== "string" || partNumber === "" || partNumber.length > 64) return false;
    if (seen.has(partNumber)) return false;
    seen.add(partNumber);
    if (typeof fingerprint !== "string") return false;
    if (typeof edits !== "object" || edits === null || Array.isArray(edits)) return false;
    const cells = Object.values(edits);
    if (cells.length === 0 || cells.length > 500) return false;
    if (!cells.every((cell) => typeof cell === "string")) return false;
  }
  return true;
}

/**
 * Save the admin product table: every edited row and every new row, or none.
 *
 * New rows are the table's replacement for "Add a product": blank part
 * numbers, so `writeImport` issues each one a fresh code in the same
 * transaction as the edits, exactly as for a blank row in an upload. Cells a
 * new row leaves empty take `BLANK_PRODUCT`'s defaults.
 *
 * Written through `writeImport`, the same path as a CSV upload and "Add a
 * product" — the facet index behind the filters, the search text, the family
 * and category counts and the stock reconciliation all live in there, and a
 * second write path would be a second place for them to drift.
 *
 * Three checks, all before anything is written:
 *   1. Each row must still be what the table showed (its fingerprint). An
 *      import, an order or another tab may have moved it; saving over that
 *      would silently undo someone else's change, or — for stock — turn the
 *      number typed into a different one once orders are re-applied. The
 *      re-read and the write are separate statements, so a write landing in
 *      the milliseconds between them is not caught; the same is true of two
 *      CSV uploads today.
 *   2. Every cell must pass the rules a CSV cell does. One bad cell refuses
 *      the lot and names every bad cell, so nobody has to guess what landed.
 *   3. Rows are complete: cells not edited carry the stored value, because the
 *      import replaces a product's whole row.
 *
 * Edits revalidate nothing. No cached page shows a product's price, stock or
 * specs — family, search and quick-order pages render per request — and a
 * whole-site purge per Save is how production hung on 2026-08-15. A Save that
 * adds products marks the cached catalog pages stale for their product
 * counts, the same narrow purge "Add a product" made.
 */
export async function saveFamilyProductsAction(
  familyId: number,
  payload: ProductEditPayload,
  newRows: ProductEdits[] = [],
): Promise<ProductTableSaveResult> {
  await assertAdminWrite();
  if (
    !Number.isInteger(familyId) ||
    familyId <= 0 ||
    !isPayload(payload) ||
    !isNewRows(newRows, IMPORT_MAX_ROWS - payload.length)
  ) {
    return { kind: "error", message: "bad-data" };
  }
  if (payload.length === 0 && newRows.length === 0) {
    return { kind: "saved", count: 0, products: [], created: [] };
  }

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "error", message: "not-found" };

  const current = await getProductsForExport(
    familyId,
    payload.map((row) => row.partNumber),
  );
  const byPart = new Map(current.map((product) => [product.partNumber, product]));
  const stale = payload
    .filter((row) => {
      const product = byPart.get(row.partNumber);
      return !product || productFingerprint(product) !== row.fingerprint;
    })
    .map((row) => row.partNumber);
  if (stale.length > 0) return { kind: "stale", partNumbers: stale };

  const rows: ImportRow[] = [];
  const invalid: InvalidCell[] = [];
  for (const edit of payload) {
    const result = applyProductEdits(byPart.get(edit.partNumber)!, edit.edits, family.defs);
    if (result.ok) rows.push(result.row);
    else invalid.push(...result.invalid.map((cell) => ({ partNumber: edit.partNumber, cell })));
  }
  const added: ImportRow[] = [];
  newRows.forEach((edits, index) => {
    const result = applyProductEdits(BLANK_PRODUCT, edits, family.defs);
    if (result.ok) added.push(result.row);
    else invalid.push(...result.invalid.map((cell) => ({ newRow: index, cell })));
  });
  if (invalid.length > 0) return { kind: "invalid", cells: invalid };

  try {
    // One write, so an edit and a new row land together or not at all; the
    // new rows' blank part numbers are minted inside it.
    const written = await writeImport(familyId, [...rows, ...added]);
    if (written.conflicts.length > 0 || written.caseVariants.length > 0) {
      return { kind: "error", message: "refused" };
    }
    // Read back rather than echoed: the import re-derives held and sold stock
    // from orders and normalises numbers, so the stored row is the truth.
    const saved = rows.length > 0
      ? await getProductsForExport(familyId, rows.map((row) => row.partNumber))
      : [];
    // Product counts on the cached catalog pages; edits alone change none.
    if (added.length > 0) revalidateCatalogPages();
    return {
      kind: "saved",
      count: written.updated,
      products: saved,
      // `writeImport` writes each issued code back into the row it was handed.
      created: added.map((row) => row.partNumber),
    };
  } catch (error) {
    // A product deleted after the re-read: its code is a tombstone now, and
    // the import refuses to bring it back.
    if (error instanceof PartNumberUnavailable) {
      return { kind: "stale", partNumbers: rows.map((row) => row.partNumber).filter(Boolean) };
    }
    throw error;
  }
}

/** A Server Action receives whatever was posted, not what its type says. */
function isPartList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= IMPORT_MAX_ROWS &&
    value.every((part) => typeof part === "string" && part !== "" && part.length <= 64)
  );
}

/** For the delete dialog: how many of the ticked rows are on unfinished orders. */
export async function countOpenOrderProductsAction(
  familyId: number,
  partNumbers: string[],
): Promise<number | null> {
  await assertAdminWrite();
  if (!Number.isInteger(familyId) || familyId <= 0 || !isPartList(partNumbers)) return null;
  return countProductsOnOpenOrders(familyId, [...new Set(partNumbers)]);
}

export type ProductTableDeleteResult =
  | { kind: "deleted"; count: number }
  | { kind: "error"; message: "not-found" | "bad-data" };

/**
 * Delete the rows ticked in the admin product table, all in one transaction.
 *
 * The confirmation is the browser's dialog listing every part number; there
 * is no typed word as on a family delete, because the list itself is what the
 * person has to read. Part numbers already gone count as nothing to do, not as
 * an error — another tab may have deleted them first — so the reply says how
 * many this call actually removed.
 *
 * Family tiles on the cached catalog pages show a product count, so those are
 * revalidated; nothing else cached shows a product.
 */
export async function deleteFamilyProductsAction(
  familyId: number,
  partNumbers: string[],
): Promise<ProductTableDeleteResult> {
  await assertAdminWrite();
  if (!Number.isInteger(familyId) || familyId <= 0 || !isPartList(partNumbers)) {
    return { kind: "error", message: "bad-data" };
  }

  const gone = await deleteFamilyProducts(familyId, [...new Set(partNumbers)]);
  if (gone === null) return { kind: "error", message: "not-found" };
  if (gone.length > 0) revalidateCatalogPages();
  return { kind: "deleted", count: gone.length };
}
