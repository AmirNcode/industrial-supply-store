import "server-only";
import { randomInt } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { holdStockForOrder } from "./inventoryQueries";
import { FAMILY_VISIBLE } from "./queries";
import type { CartLine } from "@/lib/cart";
import { unitPriceAt } from "@/lib/cart";
import type { Locale } from "@/lib/i18n";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";
import { exceedsOrderLimit } from "@/lib/invoice";
import type { Currency } from "@/lib/money";
import { planOrders, splitCart, type CheckoutMode, type PlannedOrder } from "@/lib/checkoutSplit";
import { PISH_FACTOR_TTL_HOURS, QUOTE_TTL_DAYS } from "@/lib/orders";
import { recordAudit } from "./audit";
import { splitForOrder, writeOrderShares, type OrderSplit } from "./accountRepQueries";

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
  postalCode: string;
  nationalId: string;
  economicCode: string;
};

export type SubmitOrderInput = {
  cartId: string;
  cartFingerprint: string;
  submissionKey: string;
  locale: Locale;
  /** Currency selected by the customer-facing display policy at submission. */
  currency: Currency;
  userId: string | null;
  /** The rep building this order for `userId`, or null when the customer or a guest places it. */
  placedByRepId: string | null;
  contact: QuoteContact;
  /** For a cart that is part payable now and part waiting (lib/checkoutSplit.ts). */
  mode: CheckoutMode;
  /**
   * The rate and VAT a pish-factor issued by this submission locks, or null
   * when none may be issued (no exchange rate or seller details configured) —
   * the whole cart then waits for staff, as it did before instant checkout.
   */
  pishFactor: { rate: number; vatRateBp: number } | null;
};

/** One order a submission wrote. `issued` means it carries a pish-factor. */
export type PlacedOrder = { id: number; ref: string; payToken: string; issued: boolean };

export type SubmitOrderResult =
  /**
   * `ref`/`payToken` are the order to land the customer on: the pish-factor
   * when there is one. `orders` lists everything written (two for a split).
   */
  | { kind: "created" | "replayed"; ref: string; payToken: string; orders: PlacedOrder[] }
  | { kind: "cart-changed" }
  | { kind: "empty-cart" }
  | { kind: "missing-cart" }
  | { kind: "customer-moved" }
  | { kind: "too-large" };

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
           p.in_stock AS "inStock", p.inventory_available AS available, p.specs,
           f.slug AS "familySlug", f.name_en AS "familyEn", f.name_fa AS "familyFa"
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN product_families f ON f.id = p.family_id
    JOIN categories c ON c.id = f.category_id
    -- A product hidden since it was added is not ordered (review M-3).
    WHERE ci.cart_id = ${cartId} AND ${FAMILY_VISIBLE}
    ORDER BY ci.added_at, ci.product_id
  `;
}

/** Everything a submission wrote, found again from its key (a replay). */
async function placedBySubmission(tx: Tx, submissionKey: string): Promise<PlacedOrder[]> {
  return tx<PlacedOrder[]>`
    SELECT o.id, o.ref, o.pay_token AS "payToken", (o.invoiced_at IS NOT NULL) AS issued
    FROM orders o
    WHERE o.submission_key = ${submissionKey}
       OR o.group_id = (SELECT group_id FROM orders WHERE submission_key = ${submissionKey})
    ORDER BY (o.submission_key IS NOT NULL) DESC, o.id
  `;
}

function landing(kind: "created" | "replayed", orders: PlacedOrder[]): SubmitOrderResult {
  // The keyed order is first, and it is the pish-factor when there is one.
  return { kind, ref: orders[0].ref, payToken: orders[0].payToken, orders };
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
  const before = await placedBySubmission(tx, input.submissionKey);
  if (before.length > 0) return landing("replayed", before);

  // Every cart mutation takes this same row lock. Once held, the line snapshot,
  // order, stock reservation and cart clear form one serial operation.
  const [cart] = await tx<{ id: string }[]>`
    SELECT id FROM carts WHERE id = ${input.cartId} FOR UPDATE
  `;
  if (!cart) return { kind: "missing-cart" };

  // A concurrent replay may have waited for the lock while the first request
  // committed. Check again after acquiring it before inspecting the now-empty
  // cart.
  const after = await placedBySubmission(tx, input.submissionKey);
  if (after.length > 0) return landing("replayed", after);

  // The cart's product rows, locked in id order before their stock is read.
  // This is what makes "whoever finishes checkout first gets the stock" true:
  // a second checkout for the same product waits here, then reads the shelf
  // the first one left. Same order as `lockOrderProducts`, so no deadlock.
  await tx`
    SELECT p.id FROM products p
    WHERE p.id IN (SELECT product_id FROM cart_items WHERE cart_id = ${input.cartId})
    ORDER BY p.id
    FOR UPDATE OF p
  `;
  const lines = await cartLinesInTransaction(tx, input.cartId);
  if (lines.length === 0) return { kind: "empty-cart" };

  const split = splitCart(
    lines.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      unitPriceCents: unitPriceAt(line, line.qty),
      inStock: line.inStock,
      available: line.available,
    })),
  );
  // Product, quantity, price and the shelf split, exactly as the page drew
  // them. Stock taken since the page rendered lands here, not on an invoice.
  if (quoteCartFingerprint(split.lines) !== input.cartFingerprint) return { kind: "cart-changed" };

  const totalCents = split.lines.reduce((sum, line) => sum + line.unitPriceCents * line.qty, 0);
  if (exceedsOrderLimit(totalCents)) return { kind: "too-large" };

  // Lock order is cart, products, then this customer row. Nothing that holds
  // the customer row goes on to take a cart or product lock, so it cannot cycle.
  const credit = input.userId ? await splitForOrder(tx, input.userId) : null;
  // A rep may order for a customer who lists them (and is active), or for one
  // nobody looks after. Checked again here, inside the transaction, because
  // the customer can be moved between the checkout page rendering and this write.
  if (
    input.placedByRepId !== null &&
    (input.userId === null ||
      (credit !== null && !credit.shares.some((share) => share.repId === input.placedByRepId)))
  ) {
    return { kind: "customer-moved" };
  }

  const planned = planOrders(split, input.mode, input.pishFactor !== null);
  const [{ groupId }] = await tx<{ groupId: string | null }[]>`
    SELECT CASE WHEN ${planned.length > 1} THEN gen_random_uuid() END AS "groupId"
  `;
  const byProduct = new Map(lines.map((line) => [line.productId, line]));
  const placed: PlacedOrder[] = [];
  for (const [index, plan] of planned.entries()) {
    const order = await insertOrder(tx, input, plan, {
      // Only the first order carries the key: it is unique, and a replay
      // finds the second through the group.
      submissionKey: index === 0 ? input.submissionKey : null,
      groupId,
      credit,
    });
    if (order === "replayed") return landing("replayed", await placedBySubmission(tx, input.submissionKey));

    // Snapshot names, specs and prices so a later catalog edit cannot rewrite
    // an order that has already been sent to the buyer. Submit the bounded
    // cart as one set instead of paying one database round trip per line.
    const itemSnapshots = plan.items.map((item) => {
      const line = byProduct.get(item.productId)!;
      return {
        product_id: item.productId,
        part_number: line.partNumber,
        family_name: input.locale === "fa" ? line.familyFa : line.familyEn,
        specs_snapshot: line.specs,
        qty: item.qty,
        unit_price_cents: item.unitPriceCents,
        requested_unit_price_cents: item.unitPriceCents,
        backorder: item.backorder,
      };
    });
    await tx`
      INSERT INTO order_items (order_id, product_id, part_number, family_name,
                               specs_snapshot, qty, unit_price_cents,
                               requested_unit_price_cents, backorder)
      SELECT ${order.id}, item.product_id, item.part_number, item.family_name,
             item.specs_snapshot, item.qty, item.unit_price_cents,
             item.requested_unit_price_cents, item.backorder
      FROM jsonb_to_recordset(${JSON.stringify(itemSnapshots)}::jsonb) AS item(
        product_id int,
        part_number text,
        family_name text,
        specs_snapshot jsonb,
        qty int,
        unit_price_cents int,
        requested_unit_price_cents int,
        backorder boolean
      )
    `;
    // Back-order lines hold nothing (`holdStockForOrder` skips them).
    await holdStockForOrder(tx, order.id);
    if (order.issued) {
      await recordAudit(tx, {
        actor:
          input.placedByRepId !== null
            ? { kind: "rep", id: input.placedByRepId }
            : { kind: "customer", id: input.userId },
        action: "pish-factor.issued",
        subject: { kind: "order", id: order.id },
        detail: { at: "checkout", rate: input.pishFactor?.rate, vatRateBp: input.pishFactor?.vatRateBp },
      });
    }
    placed.push(order);
  }

  await tx`DELETE FROM cart_items WHERE cart_id = ${input.cartId}`;
  await tx`UPDATE carts SET updated_at = now() WHERE id = ${input.cartId}`;

  return landing("created", placed);
}

/**
 * One order row. A pish-factor order is born `invoiced`: rate, VAT and the
 * 24-hour deadline are locked in the same statement that creates it, so there
 * is no moment at which it exists unpriced. Its official invoice number waits
 * for payment (`confirmPayment`). Anything else is `received`, with the
 * deadline staff have to quote before its held stock is released.
 */
async function insertOrder(
  tx: Tx,
  input: SubmitOrderInput,
  plan: PlannedOrder,
  extra: {
    submissionKey: string | null;
    groupId: string | null;
    credit: OrderSplit | null;
  },
): Promise<PlacedOrder | "replayed"> {
  const totalCents = plan.items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
  const lock = plan.pishFactor ? input.pishFactor : null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = quoteRef();
    const [order] = await tx<PlacedOrder[]>`
      INSERT INTO orders (submission_key, ref, company, contact_name, email,
                          phone, po_number, address, city, country, notes,
                          postal_code, buyer_national_id, buyer_economic_code,
                          locale, currency, total_cents, requested_total_cents,
                          status, user_id, placed_by_rep, placed_by_rep_id,
                          group_id, invoiced_at, fx_rate_to_rial, vat_rate_bp, expires_at)
      VALUES (
        ${extra.submissionKey},
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
        ${input.contact.postalCode},
        ${input.contact.nationalId},
        ${input.contact.economicCode},
        ${input.locale},
        ${input.currency},
        ${totalCents},
        ${totalCents},
        ${lock ? "invoiced" : "received"},
        ${input.userId},
        ${input.placedByRepId !== null},
        ${input.placedByRepId},
        ${extra.groupId},
        CASE WHEN ${lock !== null} THEN now() END,
        ${lock?.rate ?? null},
        ${lock?.vatRateBp ?? null},
        now() + CASE WHEN ${lock !== null}
                     THEN make_interval(hours => ${PISH_FACTOR_TTL_HOURS})
                     ELSE make_interval(days => ${QUOTE_TTL_DAYS}) END
      )
      ON CONFLICT DO NOTHING
      RETURNING id, ref, pay_token AS "payToken", (invoiced_at IS NOT NULL) AS issued
    `;
    if (order) {
      // Legacy rep_id / rate are set here too, together, once the shares exist.
      if (extra.credit) await writeOrderShares(tx, order.id, extra.credit);
      return order;
    }
    // A conflict on the submission key is a replay. A conflict on the short
    // human reference is merely a collision, so generate another reference.
    if (extra.submissionKey !== null) {
      const [replayed] = await tx`SELECT 1 FROM orders WHERE submission_key = ${extra.submissionKey}`;
      if (replayed) return "replayed";
    }
  }
  throw new Error("Could not allocate a unique order reference");
}

export async function submitOrderFromCart(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  return sql.begin((tx) => submitOrderFromCartInTransaction(tx, input));
}
