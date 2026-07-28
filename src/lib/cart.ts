import "server-only";
import { cookies } from "next/headers";
import { sql } from "@/db";
import type { SpecBag, PriceTier } from "@/db/schema";

const COOKIE = "isupply_cart";
const YEAR = 60 * 60 * 24 * 365;

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

/** Read-only lookup — safe to call from a page render. */
export async function getCartId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

/**
 * Creates the cart row and sets the cookie. Only callable from a Server Action
 * or Route Handler, since Next forbids mutating cookies during a page render.
 */
export async function ensureCart(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
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

export async function addLine(productId: number, qty: number): Promise<void> {
  const cartId = await ensureCart();
  // Adding an item already in the cart accumulates rather than replaces, which
  // is what happens when a buyer works down a long table and revisits a row.
  await sql`
    INSERT INTO cart_items (cart_id, product_id, qty)
    VALUES (${cartId}, ${productId}, ${qty})
    ON CONFLICT (cart_id, product_id)
    DO UPDATE SET qty = cart_items.qty + ${qty}
  `;
  await sql`UPDATE carts SET updated_at = now() WHERE id = ${cartId}`;
}

export async function setLineQty(productId: number, qty: number): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  if (qty <= 0) {
    await sql`DELETE FROM cart_items WHERE cart_id = ${id} AND product_id = ${productId}`;
    return;
  }
  await sql`
    UPDATE cart_items SET qty = ${qty}
    WHERE cart_id = ${id} AND product_id = ${productId}
  `;
}

export async function removeLine(productId: number): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  await sql`DELETE FROM cart_items WHERE cart_id = ${id} AND product_id = ${productId}`;
}

export async function clearCart(): Promise<void> {
  const id = await getCartId();
  if (!id) return;
  await sql`DELETE FROM cart_items WHERE cart_id = ${id}`;
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
