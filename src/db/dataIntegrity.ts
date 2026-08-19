import type { Sql, TransactionSql } from "postgres";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type IntegrityQuery = Sql<{}> | TransactionSql<{}>;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export type DatabaseIntegrityReport = {
  caseVariantSkuGroups: number;
  orphanOrderUsers: number;
  invalidCategories: number;
  invalidFamilies: number;
  invalidProducts: number;
  invalidCartItems: number;
  invalidOrderItems: number;
  invalidOrderAmounts: number;
  ordersWithoutItems: number;
  orderTotalMismatches: number;
  orderLifecycleMismatches: number;
  familyCountMismatches: number;
  categoryCountMismatches: number;
  facetMismatches: number;
  inventoryLedgerMismatches: number;
};

export type ReconciliationChanges = {
  familyCounts: number;
  categoryCounts: number;
  facetRowsDeleted: number;
  facetRowsUpserted: number;
  inventoryRows: number;
};

export type ReconciliationResult = {
  before: DatabaseIntegrityReport;
  changes: ReconciliationChanges;
  after: DatabaseIntegrityReport;
};

/**
 * What counts as a number in a spec cell, for every writer and reader of
 * `product_spec_values`.
 *
 * Written as a parameter rather than inline SQL because a template literal
 * eats the backslash in `\.`, which turns the decimal point into "any
 * character" and lets `10x5` reach `::numeric` and raise.
 */
export const NUMERIC_SPEC_PATTERN = "^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)$";

/**
 * Every filterable spec value as `product_spec_values` should hold it.
 *
 * One definition, because three drifting copies is what this fixes. Numeric-ness
 * is decided from the *text* of the value and the column's kind, never from its
 * JSON type: a column imported as text still holds JSON strings after an admin
 * switches its kind to number, and reading `jsonb_typeof` here would call those
 * rows wrong — the verifier would report drift for a legitimate edit, and
 * reconciliation would then strip the `val_num` that makes the range filter the
 * admin just asked for work at all.
 *
 * `trim_scale(round(v, 4))` is `specCell`'s four-decimal clamp spelled in SQL:
 * `val_text` is what a filter link matches on, so it has to be spelled the way
 * the importer spells it.
 */
function expectedFacetRows(query: IntegrityQuery) {
  return query`
    SELECT p.id AS product_id, p.family_id, d.key AS spec_key,
           CASE
             WHEN n.v IS NOT NULL THEN trim_scale(round(n.v, 4))::text
             ELSE raw.t
           END AS val_text,
           n.v::double precision AS val_num
    FROM products p
    JOIN spec_defs d ON d.family_id = p.family_id AND d.filterable
    CROSS JOIN LATERAL (SELECT p.specs ->> d.key AS t) raw
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN d.kind = 'number' AND raw.t ~ ${NUMERIC_SPEC_PATTERN}
        THEN raw.t::numeric
      END AS v
    ) n
    WHERE p.specs ? d.key
      AND jsonb_typeof(p.specs -> d.key) <> 'null'
      AND raw.t <> ''
  `;
}

/**
 * Reallocate stock buckets to the order ledger while preserving each product's
 * existing total. Passing ids scopes this to an import; omitting them repairs
 * the whole catalog inside the caller's already-audited transaction.
 */
export async function reconcileInventoryForProducts(
  tx: Tx,
  productIds?: readonly number[],
): Promise<number> {
  if (productIds?.length === 0) return 0;
  const allProducts = productIds === undefined;
  const ids = productIds ?? [];
  const rows = await tx<{ productId: number }[]>`
    WITH expected AS (
      SELECT p.id AS product_id,
             COALESCE(sum(i.qty) FILTER (
               WHERE o.status IN ('received', 'invoiced')
             ), 0)::int AS on_hold,
             COALESCE(sum(i.qty) FILTER (
               WHERE o.paid_at IS NOT NULL
             ), 0)::int AS sold
      FROM products p
      LEFT JOIN order_items i ON i.product_id = p.id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE ${allProducts} OR p.id = ANY(${ids as number[]}::int[])
      GROUP BY p.id
    )
    UPDATE products p
    SET inventory_available = p.inventory_available
                              + p.inventory_on_hold + p.inventory_sold
                              - expected.on_hold - expected.sold,
        inventory_on_hold = expected.on_hold,
        inventory_sold = expected.sold
    FROM expected
    WHERE expected.product_id = p.id
      AND (p.inventory_on_hold <> expected.on_hold OR p.inventory_sold <> expected.sold)
    RETURNING p.id AS "productId"
  `;
  return rows.length;
}

/** Problems no automated repair can safely infer an answer for. */
const BLOCKING_LABELS: ReadonlyArray<readonly [keyof DatabaseIntegrityReport, string]> = [
  ["caseVariantSkuGroups", "case-variant SKU groups"],
  ["orphanOrderUsers", "orders with orphan user ownership"],
  ["invalidCategories", "categories outside allowed ranges"],
  ["invalidFamilies", "families outside allowed ranges"],
  ["invalidProducts", "products outside allowed ranges"],
  ["invalidCartItems", "cart lines with invalid quantities"],
  ["invalidOrderItems", "order lines with invalid quantities or prices"],
  ["invalidOrderAmounts", "orders with invalid totals"],
  ["ordersWithoutItems", "orders without line items"],
  ["orderTotalMismatches", "orders whose totals disagree with their lines"],
  ["orderLifecycleMismatches", "orders with invalid invoice or lifecycle timestamps"],
] as const;

/** Values that are mechanically derivable from canonical rows. */
const DERIVED_LABELS: ReadonlyArray<readonly [keyof DatabaseIntegrityReport, string]> = [
  ["familyCountMismatches", "family product counts"],
  ["categoryCountMismatches", "category subtree product counts"],
  ["facetMismatches", "facet rows versus product specs"],
  ["inventoryLedgerMismatches", "inventory versus the order ledger"],
] as const;

export function blockingIntegrityProblems(report: DatabaseIntegrityReport): string[] {
  return BLOCKING_LABELS.flatMap(([key, label]) =>
    report[key] === 0 ? [] : [`${label}: ${report[key]}`],
  );
}

export function derivedIntegrityProblems(report: DatabaseIntegrityReport): string[] {
  return DERIVED_LABELS.flatMap(([key, label]) =>
    report[key] === 0 ? [] : [`${label}: ${report[key]}`],
  );
}

export function integrityProblems(report: DatabaseIntegrityReport): string[] {
  return [...blockingIntegrityProblems(report), ...derivedIntegrityProblems(report)];
}

/**
 * One read-only definition of database health, shared by deployment verification,
 * the reconciliation command, and the corruption integration tests.
 */
export async function inspectDatabaseIntegrity(
  query: IntegrityQuery,
): Promise<DatabaseIntegrityReport> {
  const [row] = await query<DatabaseIntegrityReport[]>`
    WITH expected_facets AS (
      ${expectedFacetRows(query)}
    ), facet_mismatches AS (
      SELECT count(*)::int AS n
      FROM expected_facets e
      FULL JOIN product_spec_values v
        ON v.product_id = e.product_id AND v.spec_key = e.spec_key
      WHERE e.product_id IS NULL
         OR v.product_id IS NULL
         OR v.family_id IS DISTINCT FROM e.family_id
         OR v.val_text IS DISTINCT FROM e.val_text
         OR v.val_num IS DISTINCT FROM e.val_num
    ), inventory_expected AS (
      SELECT p.id AS product_id,
             COALESCE(sum(i.qty) FILTER (
               WHERE o.status IN ('received', 'invoiced')
             ), 0)::int AS on_hold,
             COALESCE(sum(i.qty) FILTER (
               -- A paid order remains sold if it is cancelled before shipping;
               -- there is no refund/restock transition in this version.
               WHERE o.paid_at IS NOT NULL
             ), 0)::int AS sold
      FROM products p
      LEFT JOIN order_items i ON i.product_id = p.id
      LEFT JOIN orders o ON o.id = i.order_id
      GROUP BY p.id
    )
    SELECT
      (
        SELECT count(*)::int FROM (
          SELECT upper(part_number) FROM products
          GROUP BY upper(part_number) HAVING count(*) > 1
        ) groups
      ) AS "caseVariantSkuGroups",
      (
        SELECT count(*)::int FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.user_id IS NOT NULL AND u.id IS NULL
      ) AS "orphanOrderUsers",
      (
        SELECT count(*)::int FROM categories
        WHERE depth < 0 OR product_count < 0
      ) AS "invalidCategories",
      (
        SELECT count(*)::int FROM product_families WHERE product_count < 0
      ) AS "invalidFamilies",
      (
        SELECT count(*)::int FROM products
        WHERE part_number <> btrim(part_number)
           OR part_number = ''
           OR price_cents < 0
           OR jsonb_typeof(price_tiers) <> 'array'
           OR jsonb_path_exists(
             price_tiers,
             '$[*] ? (@.type() != "object" || !(exists(@.minQty)) || !(exists(@.priceCents)) || @.minQty.type() != "number" || @.priceCents.type() != "number" || @.minQty <= 0 || @.priceCents < 0)'
           )
           OR pack_qty <= 0
           OR lead_days < 0
           OR inventory_on_hold < 0
           OR inventory_sold < 0
      ) AS "invalidProducts",
      (
        SELECT count(*)::int FROM cart_items WHERE qty <= 0
      ) AS "invalidCartItems",
      (
        SELECT count(*)::int FROM order_items
        WHERE qty <= 0 OR requested_unit_price_cents < 0 OR unit_price_cents < 0
      ) AS "invalidOrderItems",
      (
        SELECT count(*)::int FROM orders
        WHERE requested_total_cents < 0 OR total_cents < 0
      ) AS "invalidOrderAmounts",
      (
        SELECT count(*)::int FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)
      ) AS "ordersWithoutItems",
      (
        SELECT count(*)::int
        FROM orders o
        JOIN LATERAL (
          SELECT COALESCE(sum(i.requested_unit_price_cents::bigint * i.qty), 0) AS requested,
                 COALESCE(sum(i.unit_price_cents::bigint * i.qty), 0) AS current
          FROM order_items i WHERE i.order_id = o.id
        ) line_totals ON true
        WHERE o.requested_total_cents::bigint <> line_totals.requested
           OR o.total_cents::bigint <> line_totals.current
      ) AS "orderTotalMismatches",
      (
        SELECT count(*)::int FROM orders
        WHERE NOT (
          (
            invoice_number IS NULL
            AND fx_rate_to_toman IS NULL
            AND invoiced_at IS NULL
          ) OR (
            invoice_number IS NOT NULL
            AND btrim(invoice_number) <> ''
            AND fx_rate_to_toman > 0
            AND invoiced_at IS NOT NULL
          )
        )
        OR NOT (
          (invoiced_at IS NULL OR invoiced_at >= created_at)
          AND (paid_at IS NULL OR (invoiced_at IS NOT NULL AND paid_at >= invoiced_at))
          AND (shipped_at IS NULL OR (paid_at IS NOT NULL AND shipped_at >= paid_at))
          AND (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at))
        )
        OR NOT (
          (status <> 'received' OR invoiced_at IS NULL)
          AND (status NOT IN ('invoiced','preparing','shipped','delivered') OR invoiced_at IS NOT NULL)
          AND (status NOT IN ('preparing','shipped','delivered') OR paid_at IS NOT NULL)
          AND (status NOT IN ('shipped','delivered') OR shipped_at IS NOT NULL)
          AND (status <> 'delivered' OR delivered_at IS NOT NULL)
          AND (status <> 'invoiced' OR paid_at IS NULL)
          AND (status <> 'preparing' OR shipped_at IS NULL)
          AND (status <> 'shipped' OR delivered_at IS NULL)
          AND (status <> 'cancelled' OR (shipped_at IS NULL AND delivered_at IS NULL))
        )
      ) AS "orderLifecycleMismatches",
      (
        SELECT count(*)::int FROM product_families f
        WHERE f.product_count <> (
          SELECT count(*)::int FROM products p WHERE p.family_id = f.id
        )
      ) AS "familyCountMismatches",
      (
        SELECT count(*)::int FROM categories ancestor
        WHERE ancestor.product_count <> (
          SELECT count(*)::int
          FROM products p
          JOIN product_families f ON f.id = p.family_id
          JOIN categories leaf ON leaf.id = f.category_id
          WHERE leaf.path = ancestor.path
             OR leaf.path LIKE ancestor.path || '/%'
        )
      ) AS "categoryCountMismatches",
      (SELECT n FROM facet_mismatches) AS "facetMismatches",
      (
        SELECT count(*)::int
        FROM products p
        JOIN inventory_expected e ON e.product_id = p.id
        WHERE p.inventory_on_hold <> e.on_hold OR p.inventory_sold <> e.sold
      ) AS "inventoryLedgerMismatches"
  `;
  return row!;
}

function assertReconciliationSafe(report: DatabaseIntegrityReport): void {
  const blockers = blockingIntegrityProblems(report);
  if (blockers.length > 0) {
    throw new Error(
      `Refusing derived-data reconciliation while canonical data is invalid:\n- ${blockers.join("\n- ")}`,
    );
  }
}

/**
 * Repairs only values with one deterministic source of truth. Callers must
 * provide a transaction so inspection, locks, writes, and post-check commit as
 * one audited unit.
 */
export async function reconcileDerivedData(tx: Tx): Promise<ReconciliationResult> {
  await tx`SET LOCAL lock_timeout = '5s'`;
  await tx`SET LOCAL statement_timeout = '120s'`;
  await tx`
    LOCK TABLE users, categories, product_families, spec_defs, products,
               product_spec_values, carts, cart_items, orders, order_items
    IN SHARE ROW EXCLUSIVE MODE
  `;

  const before = await inspectDatabaseIntegrity(tx);
  assertReconciliationSafe(before);

  const familyCounts = await tx<{ id: number }[]>`
    WITH actual AS (
      SELECT f.id, count(p.id)::int AS n
      FROM product_families f
      LEFT JOIN products p ON p.family_id = f.id
      GROUP BY f.id
    )
    UPDATE product_families f
    SET product_count = actual.n
    FROM actual
    WHERE actual.id = f.id AND f.product_count IS DISTINCT FROM actual.n
    RETURNING f.id
  `;

  const categoryCounts = await tx<{ id: number }[]>`
    WITH actual AS (
      SELECT ancestor.id, count(p.id)::int AS n
      FROM categories ancestor
      LEFT JOIN categories leaf
        ON leaf.path = ancestor.path OR leaf.path LIKE ancestor.path || '/%'
      LEFT JOIN product_families f ON f.category_id = leaf.id
      LEFT JOIN products p ON p.family_id = f.id
      GROUP BY ancestor.id
    )
    UPDATE categories ancestor
    SET product_count = actual.n
    FROM actual
    WHERE actual.id = ancestor.id AND ancestor.product_count IS DISTINCT FROM actual.n
    RETURNING ancestor.id
  `;

  const facetRowsDeleted = await tx<{ productId: number }[]>`
    WITH expected AS (
      ${expectedFacetRows(tx)}
    )
    DELETE FROM product_spec_values v
    WHERE NOT EXISTS (
      SELECT 1 FROM expected e
      WHERE e.product_id = v.product_id AND e.spec_key = v.spec_key
    )
    RETURNING v.product_id AS "productId"
  `;

  const facetRowsUpserted = await tx<{ productId: number }[]>`
    WITH expected AS (
      ${expectedFacetRows(tx)}
    )
    INSERT INTO product_spec_values (product_id, family_id, spec_key, val_text, val_num)
    SELECT product_id, family_id, spec_key, val_text, val_num FROM expected
    ON CONFLICT (product_id, spec_key) DO UPDATE
      SET family_id = EXCLUDED.family_id,
          val_text = EXCLUDED.val_text,
          val_num = EXCLUDED.val_num
      WHERE product_spec_values.family_id IS DISTINCT FROM EXCLUDED.family_id
         OR product_spec_values.val_text IS DISTINCT FROM EXCLUDED.val_text
         OR product_spec_values.val_num IS DISTINCT FROM EXCLUDED.val_num
    RETURNING product_id AS "productId"
  `;

  const inventoryRows = await reconcileInventoryForProducts(tx);

  const changes: ReconciliationChanges = {
    familyCounts: familyCounts.length,
    categoryCounts: categoryCounts.length,
    facetRowsDeleted: facetRowsDeleted.length,
    facetRowsUpserted: facetRowsUpserted.length,
    inventoryRows,
  };
  const after = await inspectDatabaseIntegrity(tx);
  const remaining = integrityProblems(after);
  if (remaining.length > 0) {
    throw new Error(`Reconciliation left integrity problems:\n- ${remaining.join("\n- ")}`);
  }

  return { before, changes, after };
}
