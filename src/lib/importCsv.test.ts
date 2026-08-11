import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  columnsFor,
  parseDocuments,
  parseImport,
  parseWithPlan,
  pricelessParts,
  toCsv,
  FIXED_COLUMNS,
} from "./importCsv";
import { analyzeCsv, type ImportPlan } from "./columnPlan";

const DEFS = [
  { key: "dash", kind: "text" as const },
  { key: "width", kind: "number" as const },
];

const HEADER =
  "part_number,dash,width,price_usd,pack_qty,lead_days,in_stock,inventory_available,inventory_on_hold,inventory_sold";

test("the column set is the family's spec keys between part number and the fixed tail", () => {
  assert.deepEqual(columnsFor(DEFS), [
    "part_number", "dash", "width", "price_usd", "pack_qty", "lead_days", "in_stock",
    "inventory_available", "inventory_on_hold", "inventory_sold",
  ]);
  assert.ok(FIXED_COLUMNS.includes("price_usd"));
});

test("inventory columns parse as non-negative whole numbers", () => {
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,yes,12,3,9\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].inventoryAvailable, 12);
  assert.equal(rows[0].inventoryOnHold, 3);
  assert.equal(rows[0].inventorySold, 9);
});

test("a negative or fractional inventory count is refused", () => {
  const neg = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,yes,-1,0,0\n`, DEFS);
  assert.equal(neg.errors[0].column, "inventory_available");
  const frac = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,yes,10,0.5,0\n`, DEFS);
  assert.equal(frac.errors[0].column, "inventory_on_hold");
});

test("a well-formed file parses", () => {
  const { rows, errors } = parseImport(`${HEADER}\n1000A1,004,0.07,0.35,100,0,yes,10,0,0\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "1000A1");
  assert.equal(rows[0].specs.dash, "004");
  assert.equal(rows[0].specs.width, 0.07);
  assert.equal(rows[0].priceCents, 35);
  assert.equal(rows[0].inStock, true);
});

test("prices become integer cents, including the ones that float badly", () => {
  // 0.29 * 100 is 28.999999999999996 in IEEE 754.
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,0.29,1,0,yes,10,0,0\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].priceCents, 29);
  assert.equal(Number.isInteger(rows[0].priceCents), true);
});

test("Excel's CRLF line endings and UTF-8 BOM are handled", () => {
  const withBom = `﻿${HEADER}\r\n1000A1,004,0.07,0.35,100,0,yes,10,0,0\r\n`;
  const { rows, errors } = parseImport(withBom, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "1000A1");
});

test("a quoted field containing a comma stays one field", () => {
  const defs = [{ key: "note", kind: "text" as const }];
  const header =
    "part_number,note,price_usd,pack_qty,lead_days,in_stock,inventory_available,inventory_on_hold,inventory_sold";
  const { rows, errors } = parseImport(`${header}\nP1,"black, oil-resistant",0.35,1,0,yes,10,0,0\n`, defs);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].specs.note, "black, oil-resistant");
});

test("a missing column is an error naming the column", () => {
  const { errors } = parseImport(
    "part_number,dash,price_usd,pack_qty,lead_days,in_stock,inventory_available,inventory_on_hold,inventory_sold\nP1,004,0.35,1,0,yes,10,0,0\n",
    DEFS,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "width");
  assert.match(errors[0].message, /missing/i);
});

test("an unknown column is an error rather than being ignored", () => {
  // Silently dropping it would let a supplier think they had set something.
  const header = `${HEADER},colour`;
  const { errors } = parseImport(`${header}\n1000A1,004,0.07,0.35,100,0,yes,10,0,0,black\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "colour");
  assert.match(errors[0].message, /unknown/i);
});

test("a duplicate part number within the file is an error on the second row", () => {
  const { errors } = parseImport(
    `${HEADER}\n1000A1,004,0.07,0.35,100,0,yes,10,0,0\n1000A1,005,0.08,0.40,100,0,yes,10,0,0\n`,
    DEFS,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 3);
  assert.equal(errors[0].column, "part_number");
});

test("an unparseable number is an error naming its row and column", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,wide,0.35,1,0,yes,10,0,0\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 2);
  assert.equal(errors[0].column, "width");
});

test("a negative price is refused", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,-1,1,0,yes,10,0,0\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "price_usd");
});

test("in_stock accepts what people actually type", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,0.07,0.35,1,0,YES,10,0,0\nP2,004,0.07,0.35,1,0,no,10,0,0\nP3,004,0.07,0.35,1,0,TRUE,10,0,0\n`,
    DEFS,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => r.inStock), [true, false, true]);
});

test("an unrecognised in_stock value is an error, not a silent false", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,maybe,10,0,0\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "in_stock");
});

test("a blank part number is an error", () => {
  const { errors } = parseImport(`${HEADER}\n,004,0.07,0.35,1,0,yes,10,0,0\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "part_number");
});

test("every bad row is reported, not just the first", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,bad,0.35,1,0,yes,10,0,0\nP2,004,0.07,also-bad,1,0,yes,10,0,0\n`,
    DEFS,
  );
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((e) => e.row), [2, 3]);
  assert.equal(rows.length, 0, "nothing is returned when anything failed");
});

test("an empty file is an error, not an import of nothing", () => {
  const { errors } = parseImport("", DEFS);
  assert.equal(errors.length, 1);
});

// ---------------------------------------------------------------------------
// Blank commercial columns
// ---------------------------------------------------------------------------

test("a blank price imports as call-for-price rather than being refused", () => {
  // The first real supplier file prices nothing — pricing happens on the phone.
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,,1,0,yes,10,0,0\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].priceCents, 0);
  assert.deepEqual(pricelessParts(rows), ["P1"]);
});

test("blank pack, lead, stock and inventory take the schema's defaults", () => {
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,1.50,,,,,,\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].packQty, 1, "a pack of nothing is not a pack");
  assert.equal(rows[0].leadDays, 0);
  assert.equal(rows[0].inStock, true);
  assert.equal(rows[0].inventoryAvailable, 0);
  assert.deepEqual(pricelessParts(rows), [], "1.50 is a price");
});

test("absent is allowed but wrong is still refused", () => {
  const bad = parseImport(`${HEADER}\nP1,004,0.07,free,1,0,yes,10,0,0\n`, DEFS);
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].column, "price_usd");
});

test("a spec number written with thousands separators parses", () => {
  // Excel writes pressure ratings as "3,000 ".
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,"3,000 ",0.35,1,0,yes,10,0,0\n`,
    DEFS,
  );
  assert.deepEqual(errors, []);
  assert.equal(rows[0].specs.width, 3000);
});

test("a documents cell splits on newlines, not on commas", () => {
  assert.deepEqual(parseDocuments("Datasheet\nDrawing\nIOM"), [
    { label: "Datasheet", url: "" },
    { label: "Drawing", url: "" },
    { label: "IOM", url: "" },
  ]);
  // One document with a qualifier, not two documents.
  assert.deepEqual(parseDocuments("Datasheet, Rev B"), [
    { label: "Datasheet, Rev B", url: "" },
  ]);
  assert.deepEqual(parseDocuments("  "), []);
});

// ---------------------------------------------------------------------------
// Reading a supplier's own file against a confirmed plan
// ---------------------------------------------------------------------------

const GATE_VALVE = readFileSync(
  fileURLToPath(new URL("./fixtures/gate-valve-sample.csv", import.meta.url)),
  "utf8",
);

/** The plan the admin panel would propose for the real file, unedited. */
function proposedPlan(csv: string): ImportPlan {
  const a = analyzeCsv(csv, []);
  assert.equal(a.ok, true);
  if (!a.ok) throw new Error("unreachable");
  return { headers: a.headers.map((h) => h.plan), dropKeys: [] };
}

test("the real 47-column supplier file imports against its proposed plan", () => {
  const { rows, errors } = parseWithPlan(GATE_VALVE, proposedPlan(GATE_VALVE));
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 3);

  const [first] = rows;
  assert.equal(first.partNumber, "1000000001");
  assert.equal(first.specs.pressure_rating, 3000, '"3,000 " became a number');
  assert.equal(first.specs.valve_size, '2-1/16"');
  assert.equal(first.specs.body_material, "Forged AISI 4130 (API 60K)");
  // Nothing in the file is priced or stocked.
  assert.equal(first.priceCents, 0);
  assert.equal(first.packQty, 1);
  assert.equal(first.inventoryAvailable, 0);
  assert.equal(pricelessParts(rows).length, 3);
});

test("the documents column becomes labelled documents with no files yet", () => {
  const { rows } = parseWithPlan(GATE_VALVE, proposedPlan(GATE_VALVE));
  assert.deepEqual(
    rows[0].documents.map((d) => d.label),
    ["Datasheet", "Drawing", "Certificates", "IOM"],
  );
  assert.ok(rows[0].documents.every((d) => d.url === ""));
});

test("an ignored header contributes nothing to the product", () => {
  const plan = proposedPlan(GATE_VALVE);
  const headers = plan.headers.map((h) =>
    h.header === "product_name" ? ({ role: "ignore", header: h.header } as const) : h,
  );
  const { rows, errors } = parseWithPlan(GATE_VALVE, { headers, dropKeys: [] });
  assert.deepEqual(errors, []);
  assert.equal("product_name" in rows[0].specs, false);
});

test("a plan naming a column the file lacks is refused rather than half-read", () => {
  const plan = proposedPlan(GATE_VALVE);
  const { rows, errors } = parseWithPlan("product_code,psl\nP1,3\n", plan);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /not in this file/i);
});

test("toCsv quotes what needs quoting and round-trips", () => {
  const csv = toCsv(["a", "b"], [["plain", 'has "quotes" and, comma']]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "a,b");
  assert.equal(lines[1], 'plain,"has ""quotes"" and, comma"');
});
