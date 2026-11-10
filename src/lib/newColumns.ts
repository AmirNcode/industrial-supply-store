import { isBuiltinField, prettifyLabel, slugifyKey } from "./columnPlan";
import { mobileAvailable } from "./columnVisibility";

/**
 * A column typed into the column editor's "New" row, before it exists.
 *
 * Adding a column used to mean uploading a CSV that carried it, which is a
 * whole import to get one heading. The editor now takes it directly; this is
 * the rule for turning what was typed into a `spec_defs` row, kept apart from
 * the page and the database so it can be tested on its own.
 */
export type NewColumnInput = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  inTable: boolean;
  inDetail: boolean;
  mobile: boolean;
  filterable: boolean;
};

export type NewColumn = NewColumnInput;

export type NewColumnError =
  /** Neither a key nor an English label with a letter or digit in it. */
  | { code: "noKey"; key: string }
  /** `price_usd`, `part_number` and the rest are columns on the product. */
  | { code: "builtin"; key: string }
  /** Already a column of this family, or typed twice. */
  | { code: "duplicate"; key: string };

/**
 * Where a new row starts: every box unticked, so nothing about where the
 * column shows is decided for the operator. A family is usually already at the
 * table's legible limit, and a pre-ticked box is a choice made by default.
 * Saved as is, the column exists — and is in the CSV template — but renders
 * nowhere until a box is ticked.
 */
export const NEW_COLUMN_DEFAULTS: NewColumnInput = {
  key: "",
  labelEn: "",
  labelFa: "",
  unit: "",
  kind: "text",
  inTable: false,
  inDetail: false,
  mobile: false,
  filterable: false,
};

/** Whether anything has been typed — a row with only boxes ticked is still blank. */
export function newColumnHasContent(row: Pick<NewColumnInput, "key" | "labelEn" | "labelFa" | "unit">): boolean {
  return [row.key, row.labelEn, row.labelFa, row.unit].some((v) => v.trim() !== "");
}

/**
 * The key a row will be saved under.
 *
 * Typed keys go through the same slug rule an import uses, so `Seat Material`
 * typed here and `Seat Material` in a later CSV header land on one column
 * rather than two. With no key typed the English label stands in, which is
 * what an import does with a header. Null when neither has anything a key can
 * be made of — a Persian-only label slugifies to nothing, and inventing
 * `column` for it would collide with the next one.
 */
export function newColumnKey(row: Pick<NewColumnInput, "key" | "labelEn">): string | null {
  const source = row.key.trim() || row.labelEn.trim();
  if (!/[a-z0-9]/i.test(source)) return null;
  return slugifyKey(source);
}

/**
 * Check and normalise the typed rows against the family's other columns.
 *
 * `takenKeys` must hold every key the save keeps *and* every key it deletes:
 * re-adding a column in the same save that deletes it would run in an order
 * nobody chose, and the delete takes the old values with it.
 */
export function resolveNewColumns(
  rows: readonly NewColumnInput[],
  takenKeys: Iterable<string>,
): { ok: true; columns: NewColumn[] } | { ok: false; error: NewColumnError } {
  const taken = new Set(takenKeys);
  const columns: NewColumn[] = [];
  for (const row of rows) {
    if (!newColumnHasContent(row)) continue;
    const key = newColumnKey(row);
    if (key === null) return { ok: false, error: { code: "noKey", key: row.labelFa.trim() } };
    if (isBuiltinField(key)) return { ok: false, error: { code: "builtin", key } };
    if (taken.has(key)) return { ok: false, error: { code: "duplicate", key } };
    taken.add(key);

    const labelEn = row.labelEn.trim() || prettifyLabel(key);
    columns.push({
      key,
      labelEn,
      labelFa: row.labelFa.trim() || labelEn,
      unit: row.unit.trim(),
      kind: row.kind,
      inTable: row.inTable,
      inDetail: row.inDetail,
      // The editor disables the box without the table column, but a box ticked
      // before the table column was turned off keeps its state.
      mobile: row.mobile && mobileAvailable(row),
      filterable: row.filterable,
    });
  }
  return { ok: true, columns };
}
