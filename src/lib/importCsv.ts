import { parse } from "csv-parse/sync";
import { parseNumeric, type BuiltinField, type ImportPlan } from "./columnPlan";
import { normalizeCatalogImageUrl } from "./catalogImages";
import type { ProductDocument } from "@/db/schema";

/**
 * Reading a product spreadsheet.
 *
 * Every column set is per-family, because a family owns its spec columns and
 * two families do not share them. The template download and the export
 * download emit the same columns, which is what lets someone export a family,
 * edit the prices in Excel, and upload the same file back.
 *
 * Two ways in, one row parser underneath:
 *
 *   `parseImport` — the round trip. The file must have exactly the family's
 *   columns, and anything else is an error, because a template that quietly
 *   tolerated a stray column would let someone believe they had set something.
 *
 *   `parseWithPlan` — a supplier's own file, after someone has said in the
 *   admin panel what its columns mean. The plan is the answer to "what is this
 *   column", so there is nothing left to reject on.
 *
 * No database here on purpose: this is where the phase's correctness lives, so
 * it should be testable without one.
 */

export type ImportSpecDef = { key: string; kind: "number" | "text" };

/**
 * The columns every family has, after its own spec columns.
 *
 * All three inventory counts are writable, not just `available`. `on_hold` and
 * `sold` are also maintained by the order flow, so an upload built from a stale
 * export can disagree with what orders have since moved — `writeImport` reports
 * that disagreement rather than applying it silently.
 */
export const FIXED_COLUMNS = [
  "price_usd",
  "pack_qty",
  "lead_days",
  "in_stock",
  "inventory_available",
  "inventory_on_hold",
  "inventory_sold",
] as const;

/** Included in new templates, but not required in older round-trip files. */
const OPTIONAL_COLUMNS = ["image_url"] as const;

/** The inventory columns, which share one validation rule and one warning. */
export const INVENTORY_COLUMNS = [
  "inventory_available",
  "inventory_on_hold",
  "inventory_sold",
] as const;

export function columnsFor(defs: readonly ImportSpecDef[]): string[] {
  return ["part_number", ...defs.map((d) => d.key), ...FIXED_COLUMNS, ...OPTIONAL_COLUMNS];
}

export type ImportRow = {
  partNumber: string;
  specs: Record<string, string | number>;
  priceCents: number;
  packQty: number;
  leadDays: number;
  inStock: boolean;
  inventoryAvailable: number;
  inventoryOnHold: number;
  inventorySold: number;
  /**
   * Undefined when the file had no image column, or when that cell is blank.
   *
   * The distinction matters: staff commonly add the column before every URL is
   * ready, and a blank cell must preserve an image already on that product.
   * Clearing a category/family image is an explicit admin action; product
   * images are URL-only and likewise never disappear from a blank spreadsheet.
   */
  imageUrl?: string;
  documents?: ProductDocument[];
};

/**
 * What a built-in column holds when the file does not carry it, or carries it
 * blank.
 *
 * A supplier's file is a description of the goods, not of the commercial terms
 * — the first one to arrive priced nothing, because pricing happens on the
 * phone. Refusing it would mean nobody could load a catalog until every price
 * existed.
 *
 * Absent is therefore allowed and *wrong* is still refused: text where a number
 * belongs is an error, and a zero price renders as "call for price" rather than
 * as free. The importer also counts the priceless rows back to the operator, so
 * a column cleared by accident in Excel is noticed rather than absorbed.
 */
const DEFAULTS = {
  priceCents: 0,
  packQty: 1,
  leadDays: 0,
  inStock: true,
  inventoryAvailable: 0,
  inventoryOnHold: 0,
  inventorySold: 0,
} as const;

/**
 * Split a documents cell into labels.
 *
 * Newlines and semicolons only. Commas are left alone deliberately: a cell
 * reading "Datasheet, Rev B" is one document with a qualifier far more often
 * than it is two documents.
 */
export function parseDocuments(raw: string): ProductDocument[] {
  return raw
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((label) => ({ label, url: "" }));
}

/** `row` is 1-based and counts the header, so the first data row is 2 — the
 *  number Excel shows in its gutter. An error naming a row someone cannot find
 *  is worse than no error. */
export type ImportError = { row: number; column: string; message: string };

const TRUTHY = new Set(["yes", "true", "1"]);
const FALSY = new Set(["no", "false", "0"]);

/** Where one meaningful column sits in the file, and what it is. */
type Located =
  | { role: "spec"; at: number; key: string; kind: "number" | "text" }
  | { role: "builtin"; at: number; field: BuiltinField };

function readCsv(csvText: string): { records: string[][] } | { error: ImportError } {
  try {
    return {
      records: parse(csvText, {
        // Headers are handled here rather than by `columns: true` so that a file
        // with a header and no data rows can be told apart from an empty one,
        // and so a duplicated header is visible instead of silently winning.
        columns: false,
        skip_empty_lines: true,
        // Excel writes a byte-order mark; without this the first header reads as
        // "﻿part_number" and every row fails on a missing part number.
        bom: true,
        trim: true,
        // A short or long row is reported per row below, rather than aborting
        // the whole parse with an exception that names no column.
        relax_column_count: true,
      }),
    };
  } catch (e) {
    return {
      error: { row: 1, column: "", message: `Could not read the file: ${(e as Error).message}` },
    };
  }
}

/**
 * The row loop, shared by both ways in.
 *
 * `located` has already resolved what every meaningful column means and where
 * it is, so nothing here has to know whether that came from a family's
 * definitions or from a plan someone confirmed in the admin panel.
 */
/**
 * `skipped` is populated instead of `errors` when the caller asked for bad rows
 * to be set aside. Both describe the same problems; which field they land in is
 * the difference between "nothing was written" and "these rows were left out".
 */
export type ParseOutcome = {
  rows: ImportRow[];
  errors: ImportError[];
  skipped: ImportError[];
};

function parseRows(
  dataRows: readonly string[][],
  headerLen: number,
  located: readonly Located[],
  skipBadRows: boolean,
): ParseOutcome {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];

  const partAt = located.find((c) => c.role === "builtin" && c.field === "part_number");
  const builtinAt = new Map<BuiltinField, number>();
  for (const c of located) if (c.role === "builtin") builtinAt.set(c.field, c.at);
  const specs = located.filter((c) => c.role === "spec");

  /** Case-insensitive: the database's unique index is on the raw column, so
   *  `1000a1` and `1000A1` would become two products, and every lookup in the
   *  app upper-cases before matching. Two spellings of one part number in one
   *  file is a mistake worth stopping. */
  const seenPart = new Map<string, number>();

  dataRows.forEach((record, i) => {
    const rowNo = i + 2;
    const before = errors.length;
    const cellAt = (at: number | undefined) =>
      at === undefined ? "" : (record[at] ?? "").trim();
    const field = (f: BuiltinField) => cellAt(builtinAt.get(f));

    if (record.length !== headerLen) {
      errors.push({
        row: rowNo,
        column: "",
        message: `Expected ${headerLen} columns, found ${record.length}.`,
      });
      return;
    }

    const partNumber = cellAt(partAt?.at);
    if (!partNumber) {
      errors.push({ row: rowNo, column: "part_number", message: "Part number is required." });
    } else {
      const key = partNumber.toUpperCase();
      const first = seenPart.get(key);
      if (first !== undefined) {
        errors.push({
          row: rowNo,
          column: "part_number",
          message: `Part number "${partNumber}" already appears on row ${first}.`,
        });
      } else {
        seenPart.set(key, rowNo);
      }
    }

    const bag: Record<string, string | number> = {};
    for (const def of specs) {
      const raw = cellAt(def.at);
      // An empty cell means the product has no value for that spec. The export
      // writes one for a product that lacks the spec, so refusing it here would
      // break the export-edit-upload round trip that the two downloads exist for.
      if (raw === "") continue;
      if (def.kind === "number") {
        const n = parseNumeric(raw);
        if (n === null) {
          errors.push({ row: rowNo, column: def.key, message: `"${raw}" is not a number.` });
          continue;
        }
        bag[def.key] = n;
      } else {
        bag[def.key] = raw;
      }
    }

    // Blank is absence and takes the default; anything present has to be valid.
    const priceRaw = field("price_usd");
    let priceCents: number = DEFAULTS.priceCents;
    if (priceRaw !== "") {
      const price = parseNumeric(priceRaw);
      if (price === null || price < 0) {
        errors.push({
          row: rowNo,
          column: "price_usd",
          message: `"${priceRaw}" is not a price of zero or more.`,
        });
      } else {
        priceCents = Math.round(price * 100);
      }
    }

    const counts: Record<string, number> = {
      pack_qty: DEFAULTS.packQty,
      lead_days: DEFAULTS.leadDays,
      inventory_available: DEFAULTS.inventoryAvailable,
      inventory_on_hold: DEFAULTS.inventoryOnHold,
      inventory_sold: DEFAULTS.inventorySold,
    };
    for (const name of ["pack_qty", "lead_days", ...INVENTORY_COLUMNS] as const) {
      const raw = field(name);
      if (raw === "") continue;
      const n = parseNumeric(raw);
      if (n === null || !Number.isInteger(n) || n < 0) {
        errors.push({
          row: rowNo,
          column: name,
          message: `"${raw}" is not a whole number of zero or more.`,
        });
        continue;
      }
      counts[name] = n;
    }

    const stockRaw = field("in_stock").toLowerCase();
    let inStock: boolean = DEFAULTS.inStock;
    if (stockRaw === "") inStock = DEFAULTS.inStock;
    else if (TRUTHY.has(stockRaw)) inStock = true;
    else if (FALSY.has(stockRaw)) inStock = false;
    else {
      // Falling back to false would quietly hide a product from the catalog.
      errors.push({
        row: rowNo,
        column: "in_stock",
        message: `"${stockRaw}" is not yes or no.`,
      });
    }

    const imageRaw = field("image_url");
    let imageUrl: string | undefined;
    if (imageRaw !== "") {
      const normalized = normalizeCatalogImageUrl(imageRaw);
      if (normalized === null) {
        errors.push({
          row: rowNo,
          column: "image_url",
          message: `"${imageRaw}" is not an HTTP or HTTPS image URL.`,
        });
      } else {
        imageUrl = normalized;
      }
    }

    if (errors.length > before) return;

    rows.push({
      partNumber,
      specs: bag,
      priceCents,
      packQty: counts.pack_qty,
      leadDays: counts.lead_days,
      inStock,
      inventoryAvailable: counts.inventory_available,
      inventoryOnHold: counts.inventory_on_hold,
      inventorySold: counts.inventory_sold,
      ...(builtinAt.has("image_url") && imageUrl !== undefined ? { imageUrl } : {}),
      ...(builtinAt.has("documents")
        ? { documents: parseDocuments(field("documents")) }
        : {}),
    });
  });

  /*
   * All-or-nothing unless the caller has said otherwise. Returning the good
   * rows alongside the errors by default would let a caller write a partial
   * import by ignoring the second half of the pair; `skipBadRows` is that
   * decision made deliberately, once, by someone looking at the list.
   */
  if (errors.length === 0) return { rows, errors: [], skipped: [] };
  if (skipBadRows) return { rows, errors: [], skipped: errors };
  return { rows: [], errors, skipped: [] };
}

export function parseImport(
  csvText: string,
  defs: readonly ImportSpecDef[],
): ParseOutcome {
  const expected = columnsFor(defs);
  const errors: ImportError[] = [];

  const read = readCsv(csvText);
  if ("error" in read) return { rows: [], errors: [read.error], skipped: [] };
  const { records } = read;

  if (records.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, column: "", message: "The file is empty." }],
      skipped: [],
    };
  }

  const header = records[0];
  const dataRows = records.slice(1);

  // Header problems are reported on their own. Carrying on into the rows would
  // report the same missing column once per row and bury the real message.
  const seenHeader = new Set<string>();
  for (const name of header) {
    if (seenHeader.has(name)) {
      errors.push({ row: 1, column: name, message: `Column "${name}" appears more than once.` });
    }
    seenHeader.add(name);
  }
  const required = ["part_number", ...defs.map((d) => d.key), ...FIXED_COLUMNS];
  for (const name of required) {
    if (!seenHeader.has(name)) {
      errors.push({ row: 1, column: name, message: `Column "${name}" is missing.` });
    }
  }
  for (const name of header) {
    if (!expected.includes(name)) {
      // Dropping it silently would let someone believe they had set something.
      errors.push({ row: 1, column: name, message: `Column "${name}" is unknown for this family.` });
    }
  }
  if (errors.length > 0) return { rows: [], errors, skipped: [] };

  if (dataRows.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, column: "", message: "The file has no rows." }],
      skipped: [],
    };
  }

  const at = new Map(header.map((name, i) => [name, i]));
  const located: Located[] = [
    { role: "builtin", at: at.get("part_number")!, field: "part_number" },
    ...defs.map(
      (d): Located => ({ role: "spec", at: at.get(d.key)!, key: d.key, kind: d.kind }),
    ),
    ...FIXED_COLUMNS.map(
      (name): Located => ({ role: "builtin", at: at.get(name)!, field: name }),
    ),
    ...OPTIONAL_COLUMNS.flatMap((name): Located[] => {
      const col = at.get(name);
      return col === undefined ? [] : [{ role: "builtin", at: col, field: name }];
    }),
  ];

  return parseRows(dataRows, header.length, located, false);
}

/**
 * Read a supplier's own file against the column decisions someone confirmed.
 *
 * Unlike `parseImport` there is no header validation left to do: a header the
 * plan does not mention cannot exist, because the plan was built from this
 * file's header. What remains is locating each planned column and reading the
 * rows.
 */
export function parseWithPlan(csvText: string, plan: ImportPlan): ParseOutcome {
  const read = readCsv(csvText);
  if ("error" in read) return { rows: [], errors: [read.error], skipped: [] };
  const { records } = read;

  if (records.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, column: "", message: "The file is empty." }],
      skipped: [],
    };
  }

  const header = records[0];
  const dataRows = records.slice(1);
  if (dataRows.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, column: "", message: "The file has no rows." }],
      skipped: [],
    };
  }

  const at = new Map(header.map((name, i) => [name, i]));
  const located: Located[] = [];
  for (const h of plan.headers) {
    const col = at.get(h.header);
    if (col === undefined) {
      // The plan was built from a header row; a plan naming a column this file
      // does not have means the file changed between the two stages.
      return {
        rows: [],
        errors: [
          {
            row: 1,
            column: h.header,
            message: `Column "${h.header}" is not in this file. Upload it again.`,
          },
        ],
        skipped: [],
      };
    }
    if (h.role === "spec") {
      located.push({ role: "spec", at: col, key: h.key, kind: h.specKind });
    } else if (h.role === "builtin") {
      located.push({ role: "builtin", at: col, field: h.field });
    }
  }

  return parseRows(dataRows, header.length, located, plan.skipBadRows);
}

/**
 * Part numbers that imported without a price.
 *
 * Allowed — the catalog shows "call for price" — but surfaced, because the
 * other way to arrive here is clearing the column by accident in Excel, and
 * that should not be silent.
 */
export function pricelessParts(rows: readonly ImportRow[]): string[] {
  return rows.filter((r) => r.priceCents === 0).map((r) => r.partNumber);
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function toCsv(
  columns: readonly string[],
  records: readonly (readonly string[])[],
): string {
  const lines = [columns.map(quote).join(",")];
  for (const record of records) lines.push(record.map(quote).join(","));
  return lines.join("\n") + "\n";
}

/**
 * A CSV download Excel will open correctly.
 *
 * The byte-order mark is the point: Excel on Windows reads a UTF-8 CSV without
 * one as Windows-1252, which turns every Persian name into mojibake. The
 * parser above sets `bom: true` for exactly this reason, so a file downloaded
 * here still uploads.
 */
export function csvAttachment(csv: string, filename: string): Response {
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
