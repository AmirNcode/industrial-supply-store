import { parse } from "csv-parse/sync";

/**
 * Reading a product spreadsheet.
 *
 * Every column set is per-family, because a family owns its spec columns and
 * two families do not share them. The template download and the export
 * download emit the same columns, which is what lets someone export a family,
 * edit the prices in Excel, and upload the same file back.
 *
 * No database here on purpose: this is where the phase's correctness lives, so
 * it should be testable without one.
 */

export type ImportSpecDef = { key: string; kind: "number" | "text" };

/** The columns every family has, after its own spec columns. */
export const FIXED_COLUMNS = ["price_usd", "pack_qty", "lead_days", "in_stock"] as const;

export function columnsFor(defs: readonly ImportSpecDef[]): string[] {
  return ["part_number", ...defs.map((d) => d.key), ...FIXED_COLUMNS];
}

export type ImportRow = {
  partNumber: string;
  specs: Record<string, string | number>;
  priceCents: number;
  packQty: number;
  leadDays: number;
  inStock: boolean;
};

/** `row` is 1-based and counts the header, so the first data row is 2 — the
 *  number Excel shows in its gutter. An error naming a row someone cannot find
 *  is worse than no error. */
export type ImportError = { row: number; column: string; message: string };

const TRUTHY = new Set(["yes", "true", "1"]);
const FALSY = new Set(["no", "false", "0"]);

export function parseImport(
  csvText: string,
  defs: readonly ImportSpecDef[],
): { rows: ImportRow[]; errors: ImportError[] } {
  const expected = columnsFor(defs);
  const errors: ImportError[] = [];

  let records: string[][];
  try {
    records = parse(csvText, {
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
    });
  } catch (e) {
    return {
      rows: [],
      errors: [{ row: 1, column: "", message: `Could not read the file: ${(e as Error).message}` }],
    };
  }

  if (records.length === 0) {
    return { rows: [], errors: [{ row: 1, column: "", message: "The file is empty." }] };
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
  for (const name of expected) {
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
  if (errors.length > 0) return { rows: [], errors };

  if (dataRows.length === 0) {
    return { rows: [], errors: [{ row: 1, column: "", message: "The file has no rows." }] };
  }

  const at = new Map(header.map((name, i) => [name, i]));
  const rows: ImportRow[] = [];
  /** Case-insensitive: the database's unique index is on the raw column, so
   *  `1000a1` and `1000A1` would become two products, and every lookup in the
   *  app upper-cases before matching. Two spellings of one part number in one
   *  file is a mistake worth stopping. */
  const seenPart = new Map<string, number>();

  dataRows.forEach((record, i) => {
    const rowNo = i + 2;
    const before = errors.length;
    const cell = (name: string) => (record[at.get(name)!] ?? "").trim();

    if (record.length !== header.length) {
      errors.push({
        row: rowNo,
        column: "",
        message: `Expected ${header.length} columns, found ${record.length}.`,
      });
      return;
    }

    const partNumber = cell("part_number");
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

    const specs: Record<string, string | number> = {};
    for (const def of defs) {
      const raw = cell(def.key);
      // An empty cell means the product has no value for that spec. The export
      // writes one for a product that lacks the spec, so refusing it here would
      // break the export-edit-upload round trip that the two downloads exist for.
      if (raw === "") continue;
      if (def.kind === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors.push({ row: rowNo, column: def.key, message: `"${raw}" is not a number.` });
          continue;
        }
        specs[def.key] = n;
      } else {
        specs[def.key] = raw;
      }
    }

    const priceRaw = cell("price_usd");
    const price = Number(priceRaw);
    // Number("") is 0, so emptiness is checked before finiteness — a blank
    // price would otherwise import silently as free.
    if (priceRaw === "" || !Number.isFinite(price) || price < 0) {
      errors.push({
        row: rowNo,
        column: "price_usd",
        message: `"${priceRaw}" is not a price of zero or more.`,
      });
    }

    const counts: Record<string, number> = {};
    for (const name of ["pack_qty", "lead_days"] as const) {
      const raw = cell(name);
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        errors.push({
          row: rowNo,
          column: name,
          message: `"${raw}" is not a whole number of zero or more.`,
        });
        continue;
      }
      counts[name] = n;
    }

    const stockRaw = cell("in_stock").toLowerCase();
    let inStock = false;
    if (TRUTHY.has(stockRaw)) inStock = true;
    else if (FALSY.has(stockRaw)) inStock = false;
    else {
      // Falling back to false would quietly hide a product from the catalog.
      errors.push({
        row: rowNo,
        column: "in_stock",
        message: `"${stockRaw}" is not yes or no.`,
      });
    }

    if (errors.length > before) return;

    rows.push({
      partNumber,
      specs,
      priceCents: Math.round(price * 100),
      packQty: counts.pack_qty,
      leadDays: counts.lead_days,
      inStock,
    });
  });

  // All-or-nothing. Returning the good rows alongside the errors would let a
  // caller write a partial import by ignoring the second half of the pair.
  return errors.length > 0 ? { rows: [], errors } : { rows, errors };
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
