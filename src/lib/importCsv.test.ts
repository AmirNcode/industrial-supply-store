import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsFor, parseImport, toCsv, FIXED_COLUMNS } from "./importCsv";

const DEFS = [
  { key: "dash", kind: "text" as const },
  { key: "width", kind: "number" as const },
];

const HEADER = "part_number,dash,width,price_usd,pack_qty,lead_days,in_stock";

test("the column set is the family's spec keys between part number and the fixed tail", () => {
  assert.deepEqual(columnsFor(DEFS), [
    "part_number", "dash", "width", "price_usd", "pack_qty", "lead_days", "in_stock",
  ]);
  assert.ok(FIXED_COLUMNS.includes("price_usd"));
});

test("a well-formed file parses", () => {
  const { rows, errors } = parseImport(`${HEADER}\n1000A1,004,0.07,0.35,100,0,yes\n`, DEFS);
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
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,0.29,1,0,yes\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].priceCents, 29);
  assert.equal(Number.isInteger(rows[0].priceCents), true);
});

test("Excel's CRLF line endings and UTF-8 BOM are handled", () => {
  const withBom = `﻿${HEADER}\r\n1000A1,004,0.07,0.35,100,0,yes\r\n`;
  const { rows, errors } = parseImport(withBom, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "1000A1");
});

test("a quoted field containing a comma stays one field", () => {
  const defs = [{ key: "note", kind: "text" as const }];
  const header = "part_number,note,price_usd,pack_qty,lead_days,in_stock";
  const { rows, errors } = parseImport(`${header}\nP1,"black, oil-resistant",0.35,1,0,yes\n`, defs);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].specs.note, "black, oil-resistant");
});

test("a missing column is an error naming the column", () => {
  const { errors } = parseImport("part_number,dash,price_usd,pack_qty,lead_days,in_stock\nP1,004,0.35,1,0,yes\n", DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "width");
  assert.match(errors[0].message, /missing/i);
});

test("an unknown column is an error rather than being ignored", () => {
  // Silently dropping it would let a supplier think they had set something.
  const header = `${HEADER},colour`;
  const { errors } = parseImport(`${header}\n1000A1,004,0.07,0.35,100,0,yes,black\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "colour");
  assert.match(errors[0].message, /unknown/i);
});

test("a duplicate part number within the file is an error on the second row", () => {
  const { errors } = parseImport(
    `${HEADER}\n1000A1,004,0.07,0.35,100,0,yes\n1000A1,005,0.08,0.40,100,0,yes\n`,
    DEFS,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 3);
  assert.equal(errors[0].column, "part_number");
});

test("an unparseable number is an error naming its row and column", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,wide,0.35,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 2);
  assert.equal(errors[0].column, "width");
});

test("a negative price is refused", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,-1,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "price_usd");
});

test("in_stock accepts what people actually type", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,0.07,0.35,1,0,YES\nP2,004,0.07,0.35,1,0,no\nP3,004,0.07,0.35,1,0,TRUE\n`,
    DEFS,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => r.inStock), [true, false, true]);
});

test("an unrecognised in_stock value is an error, not a silent false", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,maybe\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "in_stock");
});

test("a blank part number is an error", () => {
  const { errors } = parseImport(`${HEADER}\n,004,0.07,0.35,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "part_number");
});

test("every bad row is reported, not just the first", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,bad,0.35,1,0,yes\nP2,004,0.07,also-bad,1,0,yes\n`,
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

test("toCsv quotes what needs quoting and round-trips", () => {
  const csv = toCsv(["a", "b"], [["plain", 'has "quotes" and, comma']]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "a,b");
  assert.equal(lines[1], 'plain,"has ""quotes"" and, comma"');
});
