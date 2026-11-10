import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_COLUMN_DEFAULTS, newColumnKey, resolveNewColumns } from "./newColumns";

const row = (patch: Partial<typeof NEW_COLUMN_DEFAULTS>) => ({ ...NEW_COLUMN_DEFAULTS, ...patch });

test("a key comes from the typed key, else the English label, slugged like an import header", () => {
  assert.equal(newColumnKey(row({ key: "Seat Material" })), "seat_material");
  assert.equal(newColumnKey(row({ labelEn: "Bore Size (mm)" })), "bore_size_mm");
  assert.equal(newColumnKey(row({ key: "  ", labelEn: "Weight" })), "weight");
});

test("a Persian-only row has no key rather than an invented one", () => {
  assert.equal(newColumnKey(row({ labelFa: "وزن" })), null);
  const out = resolveNewColumns([row({ labelFa: "وزن" })], []);
  assert.deepEqual(out, { ok: false, error: { code: "noKey", key: "وزن" } });
});

test("blank rows are skipped, even with boxes ticked", () => {
  const out = resolveNewColumns([row({ inTable: true, filterable: true })], []);
  assert.deepEqual(out, { ok: true, columns: [] });
});

test("labels fall back: English from the key, Persian from the English", () => {
  const out = resolveNewColumns([row({ key: "psl_level" })], []);
  assert.ok(out.ok);
  assert.equal(out.columns[0].labelEn, "PSL Level");
  assert.equal(out.columns[0].labelFa, "PSL Level");
});

test("built-in fields, existing keys and repeats are refused", () => {
  assert.deepEqual(resolveNewColumns([row({ key: "price_usd" })], []), {
    ok: false,
    error: { code: "builtin", key: "price_usd" },
  });
  assert.deepEqual(resolveNewColumns([row({ key: "Bore Size" })], ["bore_size"]), {
    ok: false,
    error: { code: "duplicate", key: "bore_size" },
  });
  assert.deepEqual(resolveNewColumns([row({ key: "a" }), row({ labelEn: "A" })], []), {
    ok: false,
    error: { code: "duplicate", key: "a" },
  });
});

test("mobile needs the table column; filter does not", () => {
  const out = resolveNewColumns([row({ key: "x", inTable: false, mobile: true, filterable: true })], []);
  assert.ok(out.ok);
  assert.equal(out.columns[0].mobile, false);
  assert.equal(out.columns[0].filterable, true);
});
