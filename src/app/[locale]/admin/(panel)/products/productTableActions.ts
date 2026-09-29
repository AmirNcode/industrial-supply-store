"use server";

import { assertAdminWrite } from "@/lib/admin";
import { getFamilyForImport, getProductsForExport, writeImport } from "@/db/importQueries";
import { PartNumberUnavailable } from "@/db/partNumberQueries";
import { applyProductEdits, type ProductEdits } from "@/lib/productEdits";
import { productFingerprint, type CellId, type ProductRecord } from "@/lib/productTable";
import { IMPORT_MAX_ROWS } from "@/lib/importLimits";
import type { ImportRow } from "@/lib/importCsv";

/** One edited row: which product, what it looked like when shown, what changed. */
export type ProductEditPayload = {
  partNumber: string;
  fingerprint: string;
  edits: ProductEdits;
}[];

export type ProductTableSaveResult =
  /** `products` are the saved rows as stored, so the table shows them at once. */
  | { kind: "saved"; count: number; products: ProductRecord[] }
  | { kind: "invalid"; cells: { partNumber: string; cell: CellId }[] }
  | { kind: "stale"; partNumbers: string[] }
  | { kind: "error"; message: "not-found" | "bad-data" | "refused" };

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
 * Save the admin product table: every edited row, or none.
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
 * Nothing is revalidated. No cached page shows a product's price, stock or
 * specs — family, search and quick-order pages render per request — and a
 * whole-site purge per Save is how production hung on 2026-08-15.
 */
export async function saveFamilyProductsAction(
  familyId: number,
  payload: ProductEditPayload,
): Promise<ProductTableSaveResult> {
  await assertAdminWrite();
  if (!Number.isInteger(familyId) || familyId <= 0 || !isPayload(payload)) {
    return { kind: "error", message: "bad-data" };
  }
  if (payload.length === 0) return { kind: "saved", count: 0, products: [] };

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
  const invalid: { partNumber: string; cell: CellId }[] = [];
  for (const edit of payload) {
    const result = applyProductEdits(byPart.get(edit.partNumber)!, edit.edits, family.defs);
    if (result.ok) rows.push(result.row);
    else invalid.push(...result.invalid.map((cell) => ({ partNumber: edit.partNumber, cell })));
  }
  if (invalid.length > 0) return { kind: "invalid", cells: invalid };

  try {
    const written = await writeImport(familyId, rows);
    if (written.conflicts.length > 0 || written.caseVariants.length > 0) {
      return { kind: "error", message: "refused" };
    }
    // Read back rather than echoed: the import re-derives held and sold stock
    // from orders and normalises numbers, so the stored row is the truth.
    const saved = await getProductsForExport(familyId, rows.map((row) => row.partNumber));
    return { kind: "saved", count: written.updated, products: saved };
  } catch (error) {
    // A product deleted after the re-read: its code is a tombstone now, and
    // the import refuses to bring it back.
    if (error instanceof PartNumberUnavailable) {
      return { kind: "stale", partNumbers: rows.map((row) => row.partNumber) };
    }
    throw error;
  }
}
