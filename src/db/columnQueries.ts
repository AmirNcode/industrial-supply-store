import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { NUMERIC_SPEC_PATTERN } from "./dataIntegrity";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

/**
 * Editing a family's columns directly, outside an import.
 *
 * This is where the Persian labels arrive. An upload proposes a column with its
 * English header for both locales, because asking for forty translations at the
 * moment someone is trying to load a catalog is how the catalog does not get
 * loaded. Correcting them afterwards is a different job, done here.
 */

export type EditableDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  /** A column in the catalog spec table. */
  inTable: boolean;
  /** A row in the expanded product detail. Independent of `inTable`. */
  inDetail: boolean;
  /** Shown on the collapsed phone card. Only meaningful while `inTable`. */
  mobile: boolean;
  sort: number;
  /** How many products hold a value, so deleting one is an informed decision. */
  productCount: number;
};

export async function getEditableDefs(familyId: number): Promise<EditableDef[]> {
  return sql<EditableDef[]>`
    SELECT d.key, d.label_en AS "labelEn", d.label_fa AS "labelFa", d.unit,
           d.kind, d.filterable, d.in_table AS "inTable",
           d.in_detail AS "inDetail", d.mobile, d.sort,
           COALESCE(v.n, 0)::int AS "productCount"
    FROM spec_defs d
    -- One pass over the family's products rather than a subquery per column:
    -- a 47-column family would otherwise be 47 scans of the same rows.
    LEFT JOIN (
      SELECT k.key, count(*) AS n
      FROM products p, jsonb_each_text(p.specs) AS k(key, value)
      WHERE p.family_id = ${familyId} AND k.value <> ''
      GROUP BY k.key
    ) v ON v.key = d.key
    WHERE d.family_id = ${familyId}
    ORDER BY d.sort, d.id
  `;
}

export type ColumnEdit = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  inTable: boolean;
  inDetail: boolean;
  mobile: boolean;
};

/**
 * Save the edited columns.
 *
 * Two things beyond the obvious update, both in the same transaction:
 *
 *   Deleting a column removes its values from `products.specs` and its rows
 *   from the facet index, for the reasons in `syncColumns` — a stale facet row
 *   keeps offering a filter for a value no page shows.
 *
 *   Changing `filterable` or `kind` rebuilds the facet index for that column,
 *   because the index only holds filterable specs and stores numbers
 *   separately. Without this, turning a filter on would leave the sidebar
 *   offering a facet that matches nothing until the next import.
 */
export async function saveColumns(
  familyId: number,
  edits: readonly ColumnEdit[],
  dropKeys: readonly string[],
): Promise<void> {
  await sql.begin((tx) => saveColumnsInTransaction(tx, familyId, edits, dropKeys));
}

/**
 * The body of `saveColumns`, minus the transaction.
 *
 * Split out for the same reason `submitOrderFromCartInTransaction` is: the
 * facet rebuild below has to keep agreeing with the verifier, and a test can
 * only prove that if it runs this writer and `inspectDatabaseIntegrity` inside
 * one rollback.
 */
export async function saveColumnsInTransaction(
  tx: Tx,
  familyId: number,
  edits: readonly ColumnEdit[],
  dropKeys: readonly string[],
): Promise<void> {
  const before = await tx<
    { key: string; filterable: boolean; kind: string }[]
  >`SELECT key, filterable, kind FROM spec_defs WHERE family_id = ${familyId}`;
  const was = new Map(before.map((d) => [d.key, d]));

  if (edits.length > 0) {
    await tx`
      UPDATE spec_defs d SET
        label_en = u.label_en,
        label_fa = u.label_fa,
        unit = u.unit,
        kind = u.kind,
        filterable = u.filterable::boolean,
        in_table = u.in_table::boolean,
        in_detail = u.in_detail::boolean,
        mobile = u.mobile::boolean,
        sort = u.sort
      FROM unnest(
        ${edits.map((e) => e.key)}::text[],
        ${edits.map((e) => e.labelEn)}::text[],
        ${edits.map((e) => e.labelFa)}::text[],
        ${edits.map((e) => e.unit)}::text[],
        ${edits.map((e) => e.kind)}::text[],
        ${edits.map((e) => (e.filterable ? "t" : "f"))}::text[],
        ${edits.map((e) => (e.inTable ? "t" : "f"))}::text[],
        ${edits.map((e) => (e.inDetail ? "t" : "f"))}::text[],
        ${edits.map((e) => (e.mobile ? "t" : "f"))}::text[]
      ) WITH ORDINALITY AS u(key, label_en, label_fa, unit, kind, filterable,
                             in_table, in_detail, mobile, sort)
      WHERE d.family_id = ${familyId} AND d.key = u.key
    `;
  }

  if (dropKeys.length > 0) {
    const drop = dropKeys as string[];
    await tx`DELETE FROM spec_defs WHERE family_id = ${familyId} AND key = ANY(${drop}::text[])`;
    await tx`
      DELETE FROM product_spec_values
      WHERE family_id = ${familyId} AND spec_key = ANY(${drop}::text[])
    `;
    await tx`
      UPDATE products SET specs = specs - ${drop}::text[]
      WHERE family_id = ${familyId} AND specs ?| ${drop}::text[]
    `;
    // The search document still names the values just removed.
    await tx`
      UPDATE products p SET search_text = left(
        concat_ws(' ', p.part_number, f.name_en, f.name_fa, c.name_en, c.name_fa,
                  (SELECT string_agg(v.value, ' ')
                   FROM jsonb_each_text(p.specs) AS v WHERE v.value <> '')),
        2000)
      FROM product_families f JOIN categories c ON c.id = f.category_id
      WHERE p.family_id = ${familyId} AND f.id = ${familyId}
    `;
  }

  const refresh = edits.filter((e) => {
    const prev = was.get(e.key);
    if (!prev) return false;
    return prev.filterable !== e.filterable || prev.kind !== e.kind;
  });

  if (refresh.length > 0) {
    await tx`
      DELETE FROM product_spec_values
      WHERE family_id = ${familyId}
        AND spec_key = ANY(${refresh.map((edit) => edit.key)}::text[])
    `;

    const filterable = refresh.filter((edit) => edit.filterable);
    /*
     * `val_text` is what a filter link matches on, so it has to be spelled
     * exactly as the importer would spell it — `specCell` clamps a number to
     * four decimals, and without the same clamp here a value stored as
     * 0.06999999999999999 would index as an eighteen-digit string that the
     * facet it came from no longer matches.
     *
     * A numeric column whose value is not actually a number keeps its text
     * and gets no `val_num`, rather than being coerced into one.
     *
     * `NUMERIC_SPEC_PATTERN` is shared with the verifier deliberately. This
     * statement is the only writer that sees a JSON string under a `number`
     * column — the importer parses those into JSON numbers — so if the two
     * spell "is a number" differently, every kind change reads as drift.
     */
    if (filterable.length > 0) {
      await tx`
        INSERT INTO product_spec_values
          (product_id, family_id, spec_key, val_text, val_num)
        SELECT p.id, ${familyId}, changed.key,
               CASE
                 WHEN n.v IS NOT NULL THEN trim_scale(round(n.v, 4))::text
                 ELSE raw.t
               END,
               n.v::double precision
        FROM products p
        JOIN unnest(
          ${filterable.map((edit) => edit.key)}::text[],
          ${filterable.map((edit) => edit.kind)}::text[]
        ) AS changed(key, kind) ON p.specs ? changed.key
        CROSS JOIN LATERAL (SELECT p.specs ->> changed.key AS t) raw
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN changed.kind = 'number' AND raw.t ~ ${NUMERIC_SPEC_PATTERN}
            THEN raw.t::numeric
          END AS v
        ) n
        WHERE p.family_id = ${familyId} AND raw.t IS NOT NULL AND raw.t <> ''
      `;
    }
  }
}
