import "server-only";
import { randomInt } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { holdStockForOrder } from "./inventoryQueries";
import type { CartLine } from "@/lib/cart";
import { unitPriceAt } from "@/lib/cart";
import type { Locale } from "@/lib/i18n";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export type QuoteContact = {
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  address: string;
  city: string;
  country: string;
  notes: string;
};

export type SubmitOrderInput = {
  cartId: string;
  cartFingerprint: string;
  submissionKey: string;
  locale: Locale;
  userId: string | null;
  contact: QuoteContact;
};

export type SubmitOrderResult =
  | { kind: "created" | "replayed"; ref: string }
  | { kind: "cart-changed" }
  | { kind: "empty-cart" }
  | { kind: "missing-cart" };

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Six characters from an unambiguous alphabet — no O/0 or I/1 to misread aloud. */
function quoteRef(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `ORD-${out}`;
}

async function cartLinesInTransaction(tx: Tx, cartId: string): Promise<CartLine[]> {
  return tx<CartLine[]>`
    SELECT ci.product_id AS "productId", ci.qty,
           p.part_number AS "partNumber", p.price_cents AS "priceCents",
           p.price_tiers AS "priceTiers", p.pack_qty AS "packQty",
           p.in_stock AS "inStock", p.specs,
           f.slug AS "familySlug", f.name_en AS "familyEn", f.name_fa AS "familyFa"
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN product_families f ON f.id = p.family_id
    WHERE ci.cart_id = ${cartId}
    ORDER BY ci.added_at, ci.product_id
  `;
}

/**
 * The transaction body is exported so the local database integration suite can
 * exercise it and roll everything back. Request code should call
 * `submitOrderFromCart`, which owns the transaction.
 */
export async function submitOrderFromCartInTransaction(
  tx: Tx,
  input: SubmitOrderInput,
): Promise<SubmitOrderResult> {
  // Fast replay path. This also lets a successful submission survive a later
  // cart-row cleanup: the durable order is the source of truth once it exists.
  const [existingBeforeLock] = await tx<{ ref: string }[]>`
    SELECT ref FROM orders WHERE submission_key = ${input.submissionKey}
  `;
  if (existingBeforeLock) return { kind: "replayed", ref: existingBeforeLock.ref };

  // Every cart mutation takes this same row lock. Once held, the line snapshot,
  // order, stock reservation and cart clear form one serial operation.
  const [cart] = await tx<{ id: string }[]>`
    SELECT id FROM carts WHERE id = ${input.cartId} FOR UPDATE
  `;
  if (!cart) return { kind: "missing-cart" };

  // A concurrent replay may have waited for the lock while the first request
  // committed. Check again after acquiring it before inspecting the now-empty
  // cart.
  const [existingAfterLock] = await tx<{ ref: string }[]>`
    SELECT ref FROM orders WHERE submission_key = ${input.submissionKey}
  `;
  if (existingAfterLock) return { kind: "replayed", ref: existingAfterLock.ref };

  const lines = await cartLinesInTransaction(tx, input.cartId);
  if (lines.length === 0) return { kind: "empty-cart" };

  const currentFingerprint = quoteCartFingerprint(
    lines.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      unitPriceCents: unitPriceAt(line, line.qty),
    })),
  );
  if (currentFingerprint !== input.cartFingerprint) return { kind: "cart-changed" };

  const totalCents = lines.reduce(
    (sum, line) => sum + unitPriceAt(line, line.qty) * line.qty,
    0,
  );

  let order: { id: number; ref: string } | undefined;
  for (let attempt = 0; attempt < 10 && !order; attempt++) {
    const ref = quoteRef();
    [order] = await tx<{ id: number; ref: string }[]>`
      INSERT INTO orders (submission_key, ref, company, contact_name, email,
                          phone, po_number, address, city, country, notes,
                          locale, currency, total_cents, requested_total_cents,
                          status, user_id)
      VALUES (
        ${input.submissionKey},
        ${ref},
        ${input.contact.company},
        ${input.contact.contactName},
        ${input.contact.email},
        ${input.contact.phone},
        ${input.contact.poNumber},
        ${input.contact.address},
        ${input.contact.city},
        ${input.contact.country},
        ${input.contact.notes},
        ${input.locale},
        ${input.locale === "fa" ? "IRT" : "USD"},
        ${totalCents},
        ${totalCents},
        'received',
        ${input.userId}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, ref
    `;

    if (!order) {
      // A conflict on the submission key is a replay. A conflict on the short
      // human reference is merely a collision, so generate another reference.
      const [replayed] = await tx<{ ref: string }[]>`
        SELECT ref FROM orders WHERE submission_key = ${input.submissionKey}
      `;
      if (replayed) return { kind: "replayed", ref: replayed.ref };
    }
  }
  if (!order) throw new Error("Could not allocate a unique order reference");

  // Snapshot names, specs and prices so a later catalog edit cannot rewrite an
  // order that has already been sent to the buyer. Submit the bounded cart as
  // one set instead of paying one database round trip per line.
  const itemSnapshots = lines.map((line) => {
    const unitPriceCents = unitPriceAt(line, line.qty);
    return {
      product_id: line.productId,
      part_number: line.partNumber,
      family_name: input.locale === "fa" ? line.familyFa : line.familyEn,
      specs_snapshot: line.specs,
      qty: line.qty,
      unit_price_cents: unitPriceCents,
      requested_unit_price_cents: unitPriceCents,
    };
  });
  await tx`
    INSERT INTO order_items (order_id, product_id, part_number, family_name,
                             specs_snapshot, qty, unit_price_cents,
                             requested_unit_price_cents)
    SELECT ${order.id}, item.product_id, item.part_number, item.family_name,
           item.specs_snapshot, item.qty, item.unit_price_cents,
           item.requested_unit_price_cents
    FROM jsonb_to_recordset(${JSON.stringify(itemSnapshots)}::jsonb) AS item(
      product_id int,
      part_number text,
      family_name text,
      specs_snapshot jsonb,
      qty int,
      unit_price_cents int,
      requested_unit_price_cents int
    )
  `;

  await holdStockForOrder(tx, order.id);
  await tx`DELETE FROM cart_items WHERE cart_id = ${input.cartId}`;
  await tx`UPDATE carts SET updated_at = now() WHERE id = ${input.cartId}`;

  return { kind: "created", ref: order.ref };
}

export async function submitOrderFromCart(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  return sql.begin((tx) => submitOrderFromCartInTransaction(tx, input));
}
