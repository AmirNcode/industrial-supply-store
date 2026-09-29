import { parseNumeric } from "./columnPlan";
import { normalizeCatalogImageUrl } from "./catalogImages";
import type { ImportRow } from "./importCsv";
import {
  BUILTIN_FIELDS,
  specText,
  type CellId,
  type ProductRecord,
  type ProductTableDef,
} from "./productTable";

/** The cells a person changed in one row, as they typed them. */
export type ProductEdits = Partial<Record<CellId, string>>;

const MAX_INT = 2_147_483_647;

/** A whole count, or null. Blank is the fallback, as in "Add a product". */
function count(raw: string, fallback: number, min: number): number | null {
  if (raw.trim() === "") return fallback;
  const n = parseNumeric(raw);
  return n !== null && Number.isSafeInteger(n) && n >= min && n <= MAX_INT ? n : null;
}

/**
 * One edited product as a full import row, or the cells that cannot be saved.
 *
 * The same rules as "Add a product" and a CSV cell: a blank spec is no value, a
 * number column takes only numbers, a blank price is call-for-price. Cells
 * nobody touched carry the stored value through unchanged — `writeImport`
 * replaces a product's whole row, so a partial row would erase the rest.
 * An image cell is sent only when edited: a row without one keeps its image,
 * exactly as an uploaded file without that column does.
 */
export function applyProductEdits(
  product: ProductRecord,
  edits: ProductEdits,
  defs: readonly ProductTableDef[],
): { ok: true; row: ImportRow } | { ok: false; invalid: CellId[] } {
  const invalid: CellId[] = [];
  const byKey = new Map(defs.map((def) => [def.key, def]));

  const specs: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(product.specs)) {
    if (value === null || value === undefined) continue;
    specs[key] = typeof value === "number" ? value : specText(value);
  }

  let priceCents = product.priceCents;
  let packQty = product.packQty;
  let leadDays = product.leadDays;
  let inStock = product.inStock;
  let inventoryAvailable = product.inventoryAvailable;
  let imageUrl: string | undefined;

  for (const [cell, raw] of Object.entries(edits) as [CellId, string | undefined][]) {
    if (typeof raw !== "string") {
      invalid.push(cell);
      continue;
    }
    if (cell.startsWith("spec:")) {
      const key = cell.slice("spec:".length);
      const def = byKey.get(key);
      const value = raw.trim();
      if (!def) invalid.push(cell);
      else if (value === "") delete specs[key];
      else if (def.kind === "number") {
        const n = parseNumeric(value);
        if (n === null) invalid.push(cell);
        else specs[key] = n;
      } else specs[key] = value;
      continue;
    }
    if (!(BUILTIN_FIELDS as readonly string[]).includes(cell)) {
      invalid.push(cell);
      continue;
    }
    if (cell === "price") {
      if (raw.trim() === "") priceCents = 0;
      else {
        const price = parseNumeric(raw);
        const cents = price === null ? NaN : Math.round(price * 100);
        if (price === null || price < 0 || !Number.isSafeInteger(cents) || cents > MAX_INT) {
          invalid.push(cell);
        } else priceCents = cents;
      }
    } else if (cell === "qty") {
      const n = count(raw, 0, 0);
      if (n === null) invalid.push(cell);
      else inventoryAvailable = n;
    } else if (cell === "packQty") {
      const n = count(raw, 1, 1);
      if (n === null) invalid.push(cell);
      else packQty = n;
    } else if (cell === "leadDays") {
      const n = count(raw, 0, 0);
      if (n === null) invalid.push(cell);
      else leadDays = n;
    } else if (cell === "inStock") {
      if (raw === "yes" || raw === "no") inStock = raw === "yes";
      else invalid.push(cell);
    } else if (cell === "imageUrl") {
      const url = normalizeCatalogImageUrl(raw);
      if (url === null) invalid.push(cell);
      else imageUrl = url;
    }
  }

  if (invalid.length > 0) return { ok: false, invalid };
  return {
    ok: true,
    row: {
      partNumber: product.partNumber,
      specs,
      priceCents,
      packQty,
      leadDays,
      inStock,
      inventoryAvailable,
      // Carried as loaded; the save refuses if orders have moved them since,
      // and the import path re-derives both from orders regardless.
      inventoryOnHold: product.inventoryOnHold,
      inventorySold: product.inventorySold,
      imageUrl,
    },
  };
}
