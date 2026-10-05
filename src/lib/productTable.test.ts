import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_PRODUCT,
  cellText,
  newRowHasContent,
  productFingerprint,
  productTableColumns,
  type ProductRecord,
  type ProductTableDef,
} from "./productTable";
import { applyProductEdits } from "./productEdits";

const defs: ProductTableDef[] = [
  { key: "dash", labelEn: "Dash No.", labelFa: "شماره", unit: "", kind: "text" },
  { key: "width", labelEn: "Width", labelFa: "عرض", unit: "in", kind: "number" },
  { key: "material", labelEn: "Material", labelFa: "جنس", unit: "", kind: "text" },
];

const oring: ProductRecord = {
  partNumber: "1000A001",
  specs: { dash: "-010", width: 0.06999999999999999, material: "Buna-N", legacy: "kept" },
  priceCents: 35,
  packQty: 100,
  leadDays: 0,
  inStock: true,
  inventoryAvailable: 40,
  inventoryOnHold: 5,
  inventorySold: 12,
  imageUrl: "https://example.com/a.png",
};

test("part number and the first column lead, then stock and price, then the rest in /columns order", () => {
  const names = productTableColumns(defs).map((c) =>
    c.kind === "part" ? "part" : c.kind === "spec" ? c.def.key : c.field,
  );
  assert.deepEqual(names, [
    "part", "dash", "qty", "price", "width", "material",
    "packQty", "leadDays", "inStock", "onHold", "sold", "imageUrl",
  ]);
  // A family with no columns yet still has a table.
  assert.deepEqual(
    productTableColumns([]).slice(0, 3).map((c) => (c.kind === "field" ? c.field : c.kind)),
    ["part", "qty", "price"],
  );
});

test("cells read the way the CSV export writes them", () => {
  assert.equal(cellText(oring, "spec:width"), "0.07");
  assert.equal(cellText(oring, "spec:missing"), "");
  assert.equal(cellText(oring, "price"), "0.35");
  assert.equal(cellText(oring, "qty"), "40");
  assert.equal(cellText(oring, "inStock"), "yes");
  assert.equal(cellText(oring, "sold"), "12");
});

test("an edit keeps every value nobody touched, including columns the family no longer lists", () => {
  const result = applyProductEdits(oring, { price: "0.40", qty: "35" }, defs);
  assert.ok(result.ok);
  assert.deepEqual(result.row, {
    partNumber: "1000A001",
    specs: { dash: "-010", width: 0.06999999999999999, material: "Buna-N", legacy: "kept" },
    priceCents: 40,
    packQty: 100,
    leadDays: 0,
    inStock: true,
    inventoryAvailable: 35,
    inventoryOnHold: 5,
    inventorySold: 12,
    // Untouched: a row without an image keeps the one it has.
    imageUrl: undefined,
  });
});

test("blank means no value, a blank price is call-for-price, and numbers stay numbers", () => {
  const result = applyProductEdits(
    oring,
    { "spec:material": "  ", "spec:width": "1,250", price: "", inStock: "no", imageUrl: "" },
    defs,
  );
  assert.ok(result.ok);
  assert.equal("material" in result.row.specs, false);
  assert.equal(result.row.specs.width, 1250);
  assert.equal(result.row.priceCents, 0);
  assert.equal(result.row.inStock, false);
  // Clearing the cell on purpose clears the image.
  assert.equal(result.row.imageUrl, "");
});

test("every cell that cannot be saved is named, and nothing is half-applied", () => {
  const result = applyProductEdits(
    oring,
    {
      "spec:width": "wide",
      "spec:nope": "1",
      price: "-1",
      qty: "2.5",
      packQty: "0",
      leadDays: "-3",
      inStock: "maybe",
      imageUrl: "ftp://example.com/a.png",
    },
    defs,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    !result.ok && [...result.invalid].sort(),
    ["imageUrl", "inStock", "leadDays", "packQty", "price", "qty", "spec:nope", "spec:width"],
  );
});

test("the fingerprint moves when anything the table shows moves, stock included", () => {
  const before = productFingerprint(oring);
  assert.equal(productFingerprint({ ...oring, specs: { ...oring.specs } }), before);
  assert.equal(
    productFingerprint({ ...oring, specs: { legacy: "kept", material: "Buna-N", width: 0.07, dash: "-010" } }),
    before,
  );
  assert.notEqual(productFingerprint({ ...oring, inventoryOnHold: 6 }), before);
  assert.notEqual(productFingerprint({ ...oring, specs: { ...oring.specs, dash: "-011" } }), before);
  assert.notEqual(productFingerprint({ ...oring, imageUrl: "" }), before);
});

test("a new row counts only once something other than the in-stock tick is typed", () => {
  assert.equal(newRowHasContent({}), false);
  assert.equal(newRowHasContent({ inStock: "no" }), false, "the default tick alone is a mis-click");
  assert.equal(newRowHasContent({ price: "   " }), false);
  assert.equal(newRowHasContent({ "spec:dash": "-012" }), true);
});

test("a new row becomes a full product with the add-a-product defaults", () => {
  const result = applyProductEdits(BLANK_PRODUCT, { "spec:dash": "-012", "spec:width": "0.07", price: "" }, defs);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.row, {
    partNumber: "",
    specs: { dash: "-012", width: 0.07 },
    priceCents: 0,
    packQty: 1,
    leadDays: 0,
    inStock: true,
    inventoryAvailable: 0,
    inventoryOnHold: 0,
    inventorySold: 0,
    imageUrl: undefined,
  });
  const bad = applyProductEdits(BLANK_PRODUCT, { "spec:width": "wide", packQty: "0" }, defs);
  assert.deepEqual(bad, { ok: false, invalid: ["spec:width", "packQty"] });
});
