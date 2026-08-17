import "server-only";
import { cookies } from "next/headers";
import type { TransactionSql } from "postgres";
import { sql } from "@/db";
import type { SpecBag, PriceTier } from "@/db/schema";
import { REQUEST_LIMITS } from "./requestLimits";

const COOKIE = "isupply_cart";
const YEAR = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export type CartLine = {
  productId: number;
  partNumber: string;
  qty: number;
  priceCents: number;
  priceTiers: PriceTier[];
  packQty: number;
  inStock: boolean;
  specs: SpecBag;
  familySlug: string;
  familyEn: string;
  familyFa: string;
};

export class CartCapacityError extends Error {
  constructor() {
    super(`A cart can contain at most ${REQUEST_LIMITS.cartLines} distinct products`);
    this.name = "CartCapacityError";
  }
}

/** Read-only lookup — safe to call from a page render. */
export async function getCartId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

/**
 * Creates the cart row and sets the cookie. Only callable from a Server Action
 * or Route Handler, since Next forbids mutating cookies during a page render.
 */
export async function ensureCart(): Promise<string> {
  const jar = await cookies();
  const submitted = jar.get(COOKIE)?.value;
  const existing = submitted && UUID.test(submitted) ? submitted : null;
  if (existing) {
    // Guard against a cookie that outlived its row (e.g. after a reseed).
    const rows = await sql<{ id: string }[]>`SELECT id FROM carts WHERE id = ${existing}`;
    if (rows.length > 0) return existing;
  }
  const [row] = await sql<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
  jar.set(COOKIE, row.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: YEAR,
  });
  return row.id;
}

export async function getCartLines(): Promise<CartLine[]> {
  const id = await getCartId();
  if (!id) return [];
  return sql<CartLine[]>`
    SELECT ci.product_id AS "productId", ci.qty,
           p.part_number AS "partNumber", p.price_cents AS "priceCents",
           p.price_tiers AS "priceTiers", p.pack_qty AS "packQty",
           p.in_stock AS "inStock", p.specs,
           f.slug AS "familySlug", f.name_en AS "familyEn", f.name_fa AS "familyFa"
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN product_families f ON f.id = p.family_id
    WHERE ci.cart_id = ${id}
    ORDER BY ci.added_at
  `;
}

export async function getCartCount(): Promise<number> {
  const id = await getCartId();
  if (!id) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${id}
  `;
  return rows[0]?.n ?? 0;
}

/**
 * productId -> qty for the whole cart, which is what the "In Cart" column
 * needs. Returned as a plain object because it crosses to the client as JSON.
 */
export async function getCartQuantities(): Promise<Record<number, number>> {
  const id = await getCartId();
  if (!id) return {};
  const rows = await sql<{ productId: number; qty: number }[]>`
    SELECT product_id AS "productId", qty FROM cart_items WHERE cart_id = ${id}
  `;
  const out: Record<number, number> = {};
  for (const r of rows) out[r.productId] = r.qty;
  return out;
}

/**
 * Serialises cart writes with quote submission. The quote transaction locks
 * this same parent row before it snapshots lines, reserves stock, and clears
 * the cart, so an add/update racing with submit lands wholly before or after
 * that snapshot rather than being silently deleted halfway through.
 */
async function lockCart(tx: Tx, cartId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE
  `;
  return rows.length > 0;
}

/** Returns the line's resulting quantity, which the row then displays. */
export async function addLine(productId: number, qty: number): Promise<number> {
  const cartId = await ensureCart();
  const quantity = Math.max(1, Math.min(99_999, Math.trunc(qty) || 1));
  // Adding an item already in the cart accumulates rather than replaces, which
  // is what happens when a buyer works down a long table and revisits a row.
  return sql.begin(async (tx) => {
    if (!(await lockCart(tx, cartId))) throw new Error("Cart disappeared during update");
    const [row] = await tx<{ qty: number }[]>`
      WITH capacity AS (
        SELECT EXISTS (
                 SELECT 1 FROM cart_items
                 WHERE cart_id = ${cartId} AND product_id = ${productId}
               ) AS already_present,
               (SELECT count(*) FROM cart_items WHERE cart_id = ${cartId})
                 < ${REQUEST_LIMITS.cartLines} AS has_room
      )
      INSERT INTO cart_items (cart_id, product_id, qty)
      SELECT ${cartId}, ${productId}, ${quantity}
      FROM capacity
      WHERE already_present OR has_room
      ON CONFLICT (cart_id, product_id)
      DO UPDATE SET qty = least(99999, cart_items.qty + EXCLUDED.qty)
      RETURNING qty
    `;
    if (!row) throw new CartCapacityError();
    await tx`UPDATE carts SET updated_at = now() WHERE id = ${cartId}`;
    return row.qty;
  });
}

/** Add a bounded quick-order batch under one cart lock and one upsert. */
export async function addLines(
  lines: readonly { productId: number; qty: number }[],
): Promise<Map<number, number>> {
  if (lines.length === 0) return new Map();
  if (lines.length > REQUEST_LIMITS.quickOrderLines) throw new CartCapacityError();

  const aggregated = new Map<number, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.productId) || line.productId <= 0) continue;
    const qty = Math.max(1, Math.min(99_999, Math.trunc(line.qty) || 1));
    aggregated.set(
      line.productId,
      Math.min(99_999, (aggregated.get(line.productId) ?? 0) + qty),
    );
  }
  if (aggregated.size === 0) return new Map();

  const cartId = await ensureCart();
  const payload = JSON.stringify(
    [...aggregated].map(([productId, qty]) => ({ productId, qty })),
  );

  return sql.begin(async (tx) => {
    if (!(await lockCart(tx, cartId))) throw new Error("Cart disappeared during update");
    const rows = await tx<{
      productId: number | null;
      qty: number | null;
      capacityOk: boolean;
    }[]>`
      WITH incoming AS (
        SELECT "productId" AS product_id, least(99999, sum(qty))::int AS qty
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS item("productId" integer, qty integer)
        GROUP BY "productId"
      ), capacity AS (
        SELECT (
          (SELECT count(*) FROM cart_items WHERE cart_id = ${cartId}) +
          (SELECT count(*) FROM incoming i WHERE NOT EXISTS (
            SELECT 1 FROM cart_items ci
            WHERE ci.cart_id = ${cartId} AND ci.product_id = i.product_id
          ))
        ) <= ${REQUEST_LIMITS.cartLines} AS ok
      ), upserted AS (
        INSERT INTO cart_items (cart_id, product_id, qty)
        SELECT ${cartId}, i.product_id, i.qty
        FROM incoming i CROSS JOIN capacity c
        WHERE c.ok
        ON CONFLICT (cart_id, product_id)
        DO UPDATE SET qty = least(99999, cart_items.qty + EXCLUDED.qty)
        RETURNING product_id, qty
      )
      SELECT u.product_id AS "productId", u.qty, c.ok AS "capacityOk"
      FROM capacity c LEFT JOIN upserted u ON true
    `;
    if (!rows[0]?.capacityOk) throw new CartCapacityError();
    await tx`UPDATE carts SET updated_at = now() WHERE id = ${cartId}`;
    return new Map(
      rows
        .filter((row): row is typeof row & { productId: number; qty: number } =>
          row.productId !== null && row.qty !== null,
        )
        .map((row) => [row.productId, row.qty]),
    );
  });
}

export async function setLineQty(productId: number, qty: number): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  await sql.begin(async (tx) => {
    if (!(await lockCart(tx, id))) return;
    const quantity = Math.min(99_999, Math.trunc(qty));
    if (quantity <= 0) {
      await tx`DELETE FROM cart_items WHERE cart_id = ${id} AND product_id = ${productId}`;
    } else {
      await tx`
        UPDATE cart_items SET qty = ${quantity}
        WHERE cart_id = ${id} AND product_id = ${productId}
      `;
    }
    await tx`UPDATE carts SET updated_at = now() WHERE id = ${id}`;
  });
}

export async function removeLine(productId: number): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  await sql.begin(async (tx) => {
    if (!(await lockCart(tx, id))) return;
    await tx`DELETE FROM cart_items WHERE cart_id = ${id} AND product_id = ${productId}`;
    await tx`UPDATE carts SET updated_at = now() WHERE id = ${id}`;
  });
}

export async function clearCart(): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  await sql.begin(async (tx) => {
    if (!(await lockCart(tx, id))) return;
    await tx`DELETE FROM cart_items WHERE cart_id = ${id}`;
    await tx`UPDATE carts SET updated_at = now() WHERE id = ${id}`;
  });
}

/** Unit price at a given quantity, honouring the quantity breaks. */
export function unitPriceAt(line: { priceCents: number; priceTiers: PriceTier[] }, qty: number): number {
  let price = line.priceCents;
  for (const tier of line.priceTiers) {
    if (qty >= tier.minQty) price = tier.priceCents;
  }
  return price;
}

export function lineTotal(line: CartLine): number {
  return unitPriceAt(line, line.qty) * line.qty;
}
