import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  analyzeCsv,
  inferKind,
  parseNumeric,
  plannedAliases,
  plannedDefs,
  prettifyLabel,
  slugifyKey,
  uniqueKey,
  validatePlan,
  IGNORE,
  type ExistingDef,
  type HeaderPlan,
  type ImportPlan,
} from "./columnPlan";

/**
 * The real first-supplier file: its actual header and first three products,
 * trimmed only in row count. Everything awkward about it is deliberate —
 * 47 columns, thousands separators, embedded newlines, inch marks, and a
 * "Available upon customer request" sitting in columns that are otherwise
 * numeric.
 */
const GATE_VALVE = readFileSync(
  fileURLToPath(new URL("./fixtures/gate-valve-sample.csv", import.meta.url)),
  "utf8",
);

function analyzed(csv = GATE_VALVE, defs: ExistingDef[] = [], aliases = {}) {
  const a = analyzeCsv(csv, defs, aliases);
  assert.equal(a.ok, true, a.ok ? "" : a.error);
  if (!a.ok) throw new Error("unreachable");
  return a;
}

function headerFor(csv: string, name: string) {
  const found = analyzed(csv).headers.find((h) => h.plan.header === name);
  assert.ok(found, `no header named ${name}`);
  return found;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test("thousands separators and trailing spaces do not stop a number parsing", () => {
  assert.equal(parseNumeric("3,000 "), 3000);
  assert.equal(parseNumeric("80 "), 80);
  assert.equal(parseNumeric("0.07"), 0.07);
  assert.equal(parseNumeric("-2"), -2);
});

test("a comma that is not a thousands separator leaves the value as text", () => {
  assert.equal(parseNumeric("black, oil-resistant"), null);
  assert.equal(parseNumeric("1,23"), null);
});

test("a value carrying its unit is not a number", () => {
  // Stripping "mm" here would mean guessing which trailing letters are a unit,
  // and getting that wrong rewrites data silently.
  assert.equal(parseNumeric("371 mm"), null);
  assert.equal(parseNumeric('2-1/16"'), null);
  assert.equal(parseNumeric(""), null);
});

test("one non-numeric value makes the whole column text", () => {
  assert.equal(inferKind(["1", "2", "3"]), "number");
  assert.equal(inferKind(["1", "Available upon customer request"]), "text");
  // Blanks are absence, not evidence of text.
  assert.equal(inferKind(["1", "", "3"]), "number");
  assert.equal(inferKind(["", ""]), "text");
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

test("a header becomes a safe key", () => {
  assert.equal(slugifyKey("Gate Seat Material and Coating"), "gate_seat_material_and_coating");
  assert.equal(slugifyKey('Valve Size (")'), "valve_size");
  assert.equal(slugifyKey("  spaced  out  "), "spaced_out");
  assert.equal(slugifyKey("!!!"), "column");
});

test("industrial acronyms survive the label prettifier", () => {
  assert.equal(prettifyLabel("design_standard"), "Design Standard");
  assert.equal(prettifyLabel("psl_3g"), "PSL 3g");
  assert.equal(prettifyLabel("rtj_groove"), "RTJ Groove");
  assert.equal(prettifyLabel("api_6a"), "API 6a");
});

test("two headers that slugify alike get distinct keys", () => {
  const taken = new Set(["bore_size"]);
  assert.equal(uniqueKey("bore_size", taken), "bore_size_2");
  assert.equal(uniqueKey("stem_type", taken), "stem_type");
});

// ---------------------------------------------------------------------------
// Analysis of the real file
// ---------------------------------------------------------------------------

test("every column of the real gate valve file is accounted for", () => {
  const a = analyzed();
  assert.equal(a.headers.length, 47);
  assert.equal(a.rowCount, 3);
  assert.equal(a.missing.length, 0, "an empty family has nothing to lose");
});

test("obvious commercial headers map to built-in fields without being asked", () => {
  assert.deepEqual(headerFor(GATE_VALVE, "product_code").plan, {
    role: "builtin",
    header: "product_code",
    field: "part_number",
  });
  // The importer calls this lead_days; the supplier calls it lead_time.
  assert.deepEqual(headerFor(GATE_VALVE, "lead_time").plan, {
    role: "builtin",
    header: "lead_time",
    field: "lead_days",
  });
  assert.equal(headerFor(GATE_VALVE, "documents").plan.role, "builtin");
  for (const name of ["price_usd", "pack_qty", "in_stock", "inventory_available"]) {
    assert.equal(headerFor(GATE_VALVE, name).plan.role, "builtin", name);
  }
});

test("a genuinely ambiguous header is left for the operator rather than guessed", () => {
  // product_name repeats the family name and weight might be a spec or a
  // shipping field. Both are proposed as specs; neither is silently mapped.
  const name = headerFor(GATE_VALVE, "product_name");
  assert.equal(name.plan.role, "spec");
  assert.equal(name.isNew, true);
  assert.equal(headerFor(GATE_VALVE, "weight").plan.role, "spec");
});

test("new spec columns land in the expanded row, not the table", () => {
  const a = analyzed();
  const specs = a.headers.filter((h) => h.plan.role === "spec");
  assert.ok(specs.length > 30);
  assert.ok(
    specs.every((h) => h.plan.role === "spec" && h.plan.display === "detail"),
    "a 47-column table would be unreadable on the first upload",
  );
});

test("kinds are inferred from the values actually in the file", () => {
  const rating = headerFor(GATE_VALVE, "pressure_rating").plan;
  assert.equal(rating.role === "spec" && rating.specKind, "number", '"3,000 " is a number');

  const size = headerFor(GATE_VALVE, "valve_size").plan;
  assert.equal(size.role === "spec" && size.specKind, "text", '2-1/16" is not');

  // Every row of this column says "Available upon customer request".
  const cladding = headerFor(GATE_VALVE, "groove_cladding").plan;
  assert.equal(cladding.role === "spec" && cladding.specKind, "text");
});

test("a quoted value with an embedded newline stays one field", () => {
  // The documents cell is "Datasheet\nDrawing\nCertificates\nIOM".
  const docs = headerFor(GATE_VALVE, "documents");
  assert.equal(docs.samples.length, 3);
  assert.match(docs.samples[0], /Datasheet/);
  assert.match(docs.samples[0], /IOM/);
});

test("labels are prettified from the header", () => {
  const plan = headerFor(GATE_VALVE, "gate_seat_material_and_coating").plan;
  assert.equal(plan.role === "spec" && plan.labelEn, "Gate Seat Material And Coating");
  // No machine translation — a wrong Persian valve term is worse than English.
  assert.equal(plan.role === "spec" && plan.labelFa, "Gate Seat Material And Coating");
});

// ---------------------------------------------------------------------------
// Matching against a family that already has columns
// ---------------------------------------------------------------------------

const def = (over: Partial<ExistingDef> & { key: string }): ExistingDef => ({
  labelEn: over.key,
  labelFa: over.key,
  unit: "",
  kind: "text",
  filterable: false,
  display: "table",
  csvAlias: null,
  ...over,
});

test("a header matching an existing column keeps that column's settings", () => {
  const defs = [
    def({ key: "valve_size", labelEn: "Valve Size", labelFa: "اندازه شیر", unit: '"', filterable: true }),
  ];
  const a = analyzeCsv(GATE_VALVE, defs);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const found = a.headers.find((h) => h.plan.header === "valve_size");
  assert.equal(found?.isNew, false);
  assert.equal(found?.plan.role === "spec" && found.plan.labelFa, "اندازه شیر");
  assert.equal(found?.plan.role === "spec" && found.plan.filterable, true);
  assert.equal(found?.plan.role === "spec" && found.plan.display, "table");
  assert.equal(a.missing.length, 0);
});

test("a column the file has stopped carrying is reported as missing", () => {
  const defs = [def({ key: "durometer", labelEn: "Durometer" })];
  const a = analyzeCsv(GATE_VALVE, defs);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.deepEqual(a.missing, [{ key: "durometer", labelEn: "Durometer", display: "table" }]);
});

test("a remembered alias matches a header the supplier spells differently", () => {
  const defs = [def({ key: "bore_size", csvAlias: "bore_size" })];
  const a = analyzeCsv(GATE_VALVE, defs);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const found = a.headers.find((h) => h.plan.header === "bore_size");
  assert.equal(found?.isNew, false);
  assert.equal(a.missing.length, 0);
});

test("a remembered ignore is not re-proposed as a new column", () => {
  const a = analyzeCsv(GATE_VALVE, [], { product_name: IGNORE });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const found = a.headers.find((h) => h.plan.header === "product_name");
  assert.deepEqual(found?.plan, { role: "ignore", header: "product_name" });
  assert.equal(found?.isNew, false);
});

test("a remembered built-in mapping wins over the default guess", () => {
  const a = analyzeCsv(GATE_VALVE, [], { weight: "pack_qty" });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const found = a.headers.find((h) => h.plan.header === "weight");
  assert.deepEqual(found?.plan, { role: "builtin", header: "weight", field: "pack_qty" });
});

// ---------------------------------------------------------------------------
// Files that cannot be analyzed at all
// ---------------------------------------------------------------------------

test("a file with no rows, no columns or a repeated header is refused", () => {
  assert.equal(analyzeCsv("", []).ok, false);
  assert.equal(analyzeCsv("a,b\n", []).ok, false);
  const dup = analyzeCsv("a,b,a\n1,2,3\n", []);
  assert.equal(dup.ok, false);
  assert.match(dup.ok ? "" : dup.error, /more than once/i);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const spec = (key: string, over: Partial<Extract<HeaderPlan, { role: "spec" }>> = {}) =>
  ({
    role: "spec" as const,
    header: key,
    key,
    labelEn: key,
    labelFa: key,
    unit: "",
    specKind: "text" as const,
    display: "detail" as const,
    filterable: false,
    ...over,
  });

const partNo: HeaderPlan = {
  role: "builtin",
  header: "product_code",
  field: "part_number",
};

test("a plan with no part number column is refused", () => {
  const errors = validatePlan({ headers: [spec("bore_size")], dropKeys: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /part number/i);
});

test("two columns claiming the same field or key are refused", () => {
  const twoParts = validatePlan({
    headers: [partNo, { role: "builtin", header: "sku", field: "part_number" }],
    dropKeys: [],
  });
  assert.match(twoParts[0], /more than one/i);

  const twoPrices = validatePlan({
    headers: [
      partNo,
      { role: "builtin", header: "price", field: "price_usd" },
      { role: "builtin", header: "price_usd", field: "price_usd" },
    ],
    dropKeys: [],
  });
  assert.match(twoPrices[0], /price_usd/);

  const twoKeys = validatePlan({
    headers: [partNo, spec("Bore Size", { key: "bore_size" }), spec("bore-size", { key: "bore_size" })],
    dropKeys: [],
  });
  assert.match(twoKeys[0], /both named/i);
});

test("a spec column cannot be named after a built-in field", () => {
  const errors = validatePlan({
    headers: [partNo, spec("price", { key: "price_usd" })],
    dropKeys: [],
  });
  assert.match(errors[0], /built-in/i);
});

test("importing and deleting the same column in one upload is refused", () => {
  const errors = validatePlan({
    headers: [partNo, spec("bore_size")],
    dropKeys: ["bore_size"],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deleted and imported/i);
});

test("the plan from the real file validates once a part number is mapped", () => {
  const a = analyzed();
  assert.deepEqual(validatePlan({ headers: a.headers.map((h) => h.plan), dropKeys: [] }), []);
});

// ---------------------------------------------------------------------------
// Turning a plan into rows to write
// ---------------------------------------------------------------------------

test("table columns sort before detail columns", () => {
  const plan: ImportPlan = {
    headers: [
      partNo,
      spec("bore_size", { display: "detail" }),
      spec("valve_size", { display: "table" }),
      spec("psl", { display: "detail" }),
      spec("pressure_rating", { display: "table" }),
    ],
    dropKeys: [],
  };
  const defs = plannedDefs(plan);
  assert.deepEqual(
    defs.map((d) => d.key),
    ["valve_size", "pressure_rating", "bore_size", "psl"],
  );
  assert.deepEqual(defs.map((d) => d.sort), [0, 1, 2, 3]);
});

test("a spec column remembers the header it came from only when they differ", () => {
  const plan: ImportPlan = {
    headers: [partNo, spec("Bore Size", { key: "bore_size" }), spec("psl")],
    dropKeys: [],
  };
  const defs = plannedDefs(plan);
  assert.equal(defs.find((d) => d.key === "bore_size")?.csvAlias, "Bore Size");
  assert.equal(defs.find((d) => d.key === "psl")?.csvAlias, null);
});

test("built-in and ignored headers are remembered on the family", () => {
  const plan: ImportPlan = {
    headers: [partNo, { role: "ignore", header: "product_name" }, spec("psl")],
    dropKeys: [],
  };
  assert.deepEqual(plannedAliases(plan), {
    product_code: "part_number",
    product_name: IGNORE,
  });
});
