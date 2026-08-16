import { parse } from "csv-parse/sync";
import type { SpecDisplay } from "@/db/schema";

/**
 * Deciding what a spreadsheet's columns mean.
 *
 * A supplier file arrives with whatever columns the supplier keeps, and the
 * catalog cannot know them in advance — the first gate valve file has 45. This
 * module turns a header row into a proposal: which headers are specs, which are
 * built-in product fields, which are noise, and which of the family's existing
 * columns the file has stopped carrying.
 *
 * No database and no React here on purpose. The proposal is the part that has
 * to be right, and it should be testable without either.
 */

/**
 * Product fields a header can map onto instead of becoming a spec.
 *
 * These are columns on `products`, not entries in `specs`, so they are the same
 * for every family and cannot be renamed or deleted from the admin panel.
 */
export const BUILTIN_FIELDS = [
  "part_number",
  "price_usd",
  "pack_qty",
  "lead_days",
  "in_stock",
  "inventory_available",
  "inventory_on_hold",
  "inventory_sold",
  "image_url",
  "documents",
] as const;

export type BuiltinField = (typeof BUILTIN_FIELDS)[number];

const BUILTIN_SET = new Set<string>(BUILTIN_FIELDS);

export function isBuiltinField(name: string): name is BuiltinField {
  return BUILTIN_SET.has(name);
}

/** The sentinel stored in `product_families.field_aliases` for a dropped header. */
export const IGNORE = "__ignore__";

/**
 * How many catalog-table columns stay comfortably readable, part number
 * included. Past this the admin screens warn and still save: a supplier's file
 * sometimes genuinely carries twelve dimensions that all matter, and refusing
 * it would mean refusing the catalog. Nothing enforces this number — it exists
 * so both screens warn at the same point.
 */
export const MAX_LEGIBLE_COLUMNS = 10;

/** What one header in the uploaded file becomes. */
export type HeaderPlan =
  | { role: "ignore"; header: string }
  | { role: "builtin"; header: string; field: BuiltinField }
  | {
      role: "spec";
      header: string;
      key: string;
      labelEn: string;
      labelFa: string;
      unit: string;
      specKind: "number" | "text";
      display: SpecDisplay;
      filterable: boolean;
    };

/**
 * The confirmed decisions for one upload: what every header becomes, plus which
 * of the family's existing spec columns to delete.
 *
 * `dropKeys` is separate from `headers` because a deleted column is precisely
 * the one the file does *not* mention — there is no header to hang it off.
 */
/**
 * What an upload does to the products already in the family.
 *
 * `update` matches on part number: rows in the file are written, products it
 * does not mention are left alone. `replace` additionally deletes those it does
 * not mention, which is what you want when a supplier sends a new catalog and
 * the old rows are a different product line with none of the new columns.
 *
 * Orders survive either way — `order_items` snapshots the part number and specs
 * and holds `product_id` with `ON DELETE SET NULL`.
 */
export type ImportMode = "update" | "replace";

export type ImportPlan = {
  headers: HeaderPlan[];
  dropKeys: string[];
  mode: ImportMode;
  /**
   * Import the good rows and set the bad ones aside, rather than refusing the
   * file. Three duplicate part numbers in a file of thirty-six should not mean
   * redoing the column mapping.
   */
  skipBadRows: boolean;
};

/** A family's current column, as the analyzer needs to see it. */
export type ExistingDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  display: SpecDisplay;
  csvAlias: string | null;
};

export type AnalyzedHeader = {
  plan: HeaderPlan;
  /** False when the header matched an existing column, an alias or a built-in. */
  isNew: boolean;
  /** A few real values, so the operator can see what they are deciding about. */
  samples: string[];
};

export type MissingColumn = {
  key: string;
  labelEn: string;
  display: SpecDisplay;
};

export type Analysis =
  | { ok: false; error: string }
  | {
      ok: true;
      headers: AnalyzedHeader[];
      missing: MissingColumn[];
      /** Data rows in the file, for "247 products will be imported". */
      rowCount: number;
    };

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * A spreadsheet number, or null if the text is not one.
 *
 * Thousands separators and trailing spaces are stripped because Excel writes
 * both — the pressure ratings in the first real file are all `"3,000 "`. A unit
 * is deliberately *not* stripped: `"371 mm"` stays text, because guessing that
 * `mm` is a unit rather than part of the value is the kind of cleverness that
 * silently mangles one column in forty. Units are set on the edit page, where
 * someone is looking at the column.
 */
export function parseNumeric(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Only between digits, so "1,234" is 1234 but "black, red" stays text.
  const bare = trimmed.replace(/(?<=\d),(?=\d{3}\b)/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(bare)) return null;
  const n = Number(bare);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a column reads as numeric.
 *
 * Every non-empty value has to parse. One `"Available upon customer request"`
 * in a column of pressures makes the whole column text, which is correct: a
 * numeric column that cannot hold the value a supplier actually wrote would
 * reject the file rather than describe the product.
 */
export function inferKind(samples: readonly string[]): "number" | "text" {
  const values = samples.filter((s) => s.trim() !== "");
  if (values.length === 0) return "text";
  return values.every((v) => parseNumeric(v) !== null) ? "number" : "text";
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Terms that look wrong in Title Case. Industrial specs are dense with them,
 * and "Api 6A Psl" reads as a mistake in a customer-facing table header.
 */
const ACRONYMS = new Set([
  "api", "psl", "pr", "rtj", "id", "od", "npt", "hnbr", "ptfe", "nace",
  "iso", "astm", "asme", "psi", "mm", "cnc", "qpq", "hvof", "iom", "sku",
  "url", "pn", "en", "fa", "uv", "ansi", "din", "bsp", "hs",
]);

/** A jsonb key and CSV column name: lowercase, underscore-separated, safe. */
export function slugifyKey(header: string): string {
  const slug = header
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // A header of pure punctuation would otherwise produce an empty key, which
  // would collide with the next one and silently merge two columns.
  return slug === "" ? "column" : slug;
}

/** A readable heading from a machine header: `bore_size` -> `Bore Size`. */
export function prettifyLabel(header: string): string {
  const words = header
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return header.trim();
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return w.toUpperCase();
      // Leave anything already mixed-case alone — "psiG" or "NACE" typed by
      // hand is more likely deliberate than accidental.
      if (/[A-Z]/.test(w.slice(1))) return w;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Make `key` unique against everything already claimed.
 *
 * Two different headers can slugify to the same key — `Bore Size` and
 * `bore-size` both give `bore_size`. Without this the second silently
 * overwrites the first in the specs object and one column of data disappears.
 */
export function uniqueKey(key: string, taken: ReadonlySet<string>): string {
  if (!taken.has(key)) return key;
  for (let n = 2; ; n++) {
    const candidate = `${key}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Values worth showing the operator per column. */
const SAMPLE_COUNT = 3;
/** Rows read to infer kinds. Enough to catch a stray text value; cheap. */
const INFER_ROWS = 200;

/**
 * Headers whose meaning is obvious enough to map without being asked.
 *
 * Only unambiguous synonyms belong here. Anything that is a judgement call —
 * whether `weight` is a spec or a shipping field, say — is left for the
 * operator, because a wrong guess made silently is worse than a question.
 */
const HEADER_SYNONYMS: Record<string, BuiltinField | typeof IGNORE> = {
  product_code: "part_number",
  part_no: "part_number",
  part_number: "part_number",
  partnumber: "part_number",
  sku: "part_number",
  price: "price_usd",
  price_usd: "price_usd",
  unit_price: "price_usd",
  pack_qty: "pack_qty",
  lead_days: "lead_days",
  lead_time: "lead_days",
  in_stock: "in_stock",
  inventory_available: "inventory_available",
  inventory_on_hold: "inventory_on_hold",
  inventory_sold: "inventory_sold",
  image: "image_url",
  image_url: "image_url",
  documents: "documents",
};

/**
 * Read a file's header row and propose what every column means.
 *
 * Resolution order per header, first match winning:
 *   1. a remembered decision in `aliases` — what the operator chose last time
 *   2. an existing spec column, by key or by its remembered `csv_alias`
 *   3. an obvious synonym of a built-in field
 *   4. otherwise: a new spec column, kind inferred from the values
 */
export function analyzeCsv(
  csvText: string,
  defs: readonly ExistingDef[],
  aliases: Readonly<Record<string, string>> = {},
): Analysis {
  let records: string[][];
  try {
    records = parse(csvText, {
      columns: false,
      skip_empty_lines: true,
      bom: true,
      trim: false,
      relax_column_count: true,
    });
  } catch (e) {
    return { ok: false, error: `Could not read the file: ${(e as Error).message}` };
  }

  if (records.length === 0) return { ok: false, error: "The file is empty." };

  const header = records[0].map((h) => h.trim());
  if (header.length === 0) return { ok: false, error: "The file has no columns." };

  const dataRows = records.slice(1);
  if (dataRows.length === 0) return { ok: false, error: "The file has no rows." };

  const duplicate = header.find((h, i) => header.indexOf(h) !== i);
  if (duplicate !== undefined) {
    // Two columns of the same name cannot be told apart, and picking one would
    // discard the other's data without saying so.
    return { ok: false, error: `Column "${duplicate}" appears more than once.` };
  }

  const byKey = new Map(defs.map((d) => [d.key, d]));
  const byAlias = new Map(
    defs.filter((d) => d.csvAlias).map((d) => [d.csvAlias as string, d]),
  );

  const sampleRows = dataRows.slice(0, INFER_ROWS);
  const taken = new Set<string>(defs.map((d) => d.key));
  const matchedKeys = new Set<string>();

  const headers: AnalyzedHeader[] = header.map((name, col) => {
    const values = sampleRows.map((r) => (r[col] ?? "").trim());
    const samples = values.filter((v) => v !== "").slice(0, SAMPLE_COUNT);

    const remembered = aliases[name];
    if (remembered === IGNORE) {
      return { plan: { role: "ignore", header: name }, isNew: false, samples };
    }
    if (remembered !== undefined && isBuiltinField(remembered)) {
      return {
        plan: { role: "builtin", header: name, field: remembered },
        isNew: false,
        samples,
      };
    }

    const existing = byKey.get(name) ?? byAlias.get(name);
    if (existing) {
      matchedKeys.add(existing.key);
      return {
        plan: {
          role: "spec",
          header: name,
          key: existing.key,
          labelEn: existing.labelEn,
          labelFa: existing.labelFa,
          unit: existing.unit,
          specKind: existing.kind,
          display: existing.display,
          filterable: existing.filterable,
        },
        isNew: false,
        samples,
      };
    }

    const synonym = HEADER_SYNONYMS[name.toLowerCase()];
    if (synonym !== undefined && synonym !== IGNORE) {
      return {
        plan: { role: "builtin", header: name, field: synonym },
        isNew: false,
        samples,
      };
    }

    const key = uniqueKey(slugifyKey(name), taken);
    taken.add(key);
    const label = prettifyLabel(name);
    return {
      plan: {
        role: "spec",
        header: name,
        key,
        labelEn: label,
        // No machine translation: a wrong Persian label for a valve term is
        // worse than an English one, and the edit page is where these get set.
        labelFa: label,
        unit: "",
        specKind: inferKind(values),
        // New columns land in the expanded row. A file with forty of them would
        // otherwise produce a table nobody can read, and promoting the six that
        // matter is a smaller job than demoting thirty-nine.
        display: "detail",
        filterable: false,
      },
      isNew: true,
      samples,
    };
  });

  const missing: MissingColumn[] = defs
    .filter((d) => !matchedKeys.has(d.key))
    .map((d) => ({ key: d.key, labelEn: d.labelEn, display: d.display }));

  return { ok: true, headers, missing, rowCount: dataRows.length };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Reasons a confirmed plan cannot be applied.
 *
 * Checked on the server even though the UI prevents most of them: the plan
 * arrives as a form field, and a form field is whatever the client sends.
 */
/** A spec key is a jsonb key, a CSV column name and part of a query string. */
const KEY_SHAPE = /^[a-z0-9_]+$/;

/**
 * Read a plan that arrived as a form field.
 *
 * The confirm screen builds this in the browser, so it is whatever the client
 * sent — every field is checked before anything acts on it. Returns null rather
 * than throwing, because the caller's answer to a malformed plan is to ask for
 * the upload again, not to show a stack trace.
 */
export function parsePlanJson(raw: unknown): ImportPlan | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { headers, dropKeys, mode, skipBadRows } = parsed as Record<string, unknown>;
  if (!Array.isArray(headers) || !Array.isArray(dropKeys)) return null;
  if (!dropKeys.every((k): k is string => typeof k === "string")) return null;
  if (mode !== "update" && mode !== "replace") return null;
  if (typeof skipBadRows !== "boolean") return null;

  const out: HeaderPlan[] = [];
  for (const h of headers) {
    if (typeof h !== "object" || h === null) return null;
    const o = h as Record<string, unknown>;
    if (typeof o.header !== "string" || o.header === "") return null;

    if (o.role === "ignore") {
      out.push({ role: "ignore", header: o.header });
    } else if (o.role === "builtin") {
      if (typeof o.field !== "string" || !isBuiltinField(o.field)) return null;
      out.push({ role: "builtin", header: o.header, field: o.field });
    } else if (o.role === "spec") {
      if (typeof o.key !== "string" || !KEY_SHAPE.test(o.key)) return null;
      if (o.specKind !== "number" && o.specKind !== "text") return null;
      if (o.display !== "table" && o.display !== "detail") return null;
      if (typeof o.labelEn !== "string" || typeof o.labelFa !== "string") return null;
      if (typeof o.unit !== "string") return null;
      if (typeof o.filterable !== "boolean") return null;
      out.push({
        role: "spec",
        header: o.header,
        key: o.key,
        // Trimmed here rather than trusted: a label of spaces would render as
        // a blank column heading with no way to tell which column it is.
        labelEn: o.labelEn.trim() || o.key,
        labelFa: o.labelFa.trim() || o.labelEn.trim() || o.key,
        unit: o.unit.trim(),
        specKind: o.specKind,
        display: o.display,
        filterable: o.filterable,
      });
    } else {
      return null;
    }
  }

  return { headers: out, dropKeys, mode, skipBadRows };
}

export function validatePlan(plan: ImportPlan): string[] {
  const errors: string[] = [];

  /*
   * One message per clashing field, naming the columns.
   *
   * Reported per field rather than per offending column: mapping ten columns
   * to `documents` used to emit nine identical lines that named neither the
   * field's columns nor which one to change, which is a wall of text saying
   * nothing.
   */
  const byField = new Map<BuiltinField, string[]>();
  for (const h of plan.headers) {
    if (h.role !== "builtin") continue;
    const cols = byField.get(h.field) ?? [];
    cols.push(h.header);
    byField.set(h.field, cols);
  }

  const partNumberCols = byField.get("part_number") ?? [];
  if (partNumberCols.length === 0) {
    errors.push("No column is mapped to the part number, so rows cannot be identified.");
  }

  for (const [field, cols] of byField) {
    if (cols.length < 2) continue;
    const list = cols.map((c) => `"${c}"`).join(", ");
    const name = field === "part_number" ? "the part number" : field;
    errors.push(
      `More than one column is mapped to ${name}: ${list}. ` +
        `Only one column can be — set the others to "Product spec" or ignore them.`,
    );
  }

  const seenKey = new Set<string>();
  for (const h of plan.headers) {
    if (h.role !== "spec") continue;
    if (h.key === "") {
      errors.push(`Column "${h.header}" has no name.`);
      continue;
    }
    if (isBuiltinField(h.key)) {
      errors.push(`Column "${h.header}" cannot be named "${h.key}" — that is a built-in field.`);
    }
    if (seenKey.has(h.key)) {
      errors.push(`Two columns are both named "${h.key}".`);
    }
    seenKey.add(h.key);
  }

  for (const key of plan.dropKeys) {
    if (seenKey.has(key)) {
      // Deleting a column the same upload is writing would apply in an order
      // nobody intended, whichever order that turned out to be.
      errors.push(`Column "${key}" is set to be deleted and imported at the same time.`);
    }
  }

  return errors;
}

/**
 * The `spec_defs` rows a plan implies, in table-then-detail order.
 *
 * Sort is assigned here rather than carried in the plan so the two tiers stay
 * contiguous: a table column can never sort after a detail column, which is
 * what lets the spec table render `display === "table"` as a plain prefix.
 */
export type PlannedDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  display: SpecDisplay;
  csvAlias: string | null;
  sort: number;
};

export function plannedDefs(plan: ImportPlan): PlannedDef[] {
  const specs = plan.headers.filter((h) => h.role === "spec");
  const ordered = [
    ...specs.filter((h) => h.display === "table"),
    ...specs.filter((h) => h.display === "detail"),
  ];
  return ordered.map((h, i) => ({
    key: h.key,
    labelEn: h.labelEn,
    labelFa: h.labelFa,
    unit: h.unit,
    kind: h.specKind,
    filterable: h.filterable,
    display: h.display,
    csvAlias: h.header === h.key ? null : h.header,
    sort: i,
  }));
}

/** The header decisions that belong on the family rather than on a column. */
export function plannedAliases(plan: ImportPlan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of plan.headers) {
    if (h.role === "builtin") out[h.header] = h.field;
    else if (h.role === "ignore") out[h.header] = IGNORE;
  }
  return out;
}
