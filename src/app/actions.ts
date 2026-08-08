"use server";

import { redirect } from "next/navigation";
import { sql } from "@/db";
import { addLine, setLineQty, removeLine, clearCart, getCartLines, unitPriceAt } from "@/lib/cart";
import { findByPartNumbers } from "@/db/queries";
import { safeLocale } from "@/lib/i18n";
import { currentUserId } from "@/lib/session";
import { holdStockForOrder } from "@/db/inventoryQueries";

/**
 * Deliberately no `revalidatePath`.
 *
 * The cart is read on the client: `CartBadge` and `InCartQty` render from the
 * shared copy `CartSync` pulls from /api/cart on each navigation, precisely so
 * the surrounding page can stay cached. No cached page renders cart contents,
 * and none renders inventory either, so there is nothing for a cart mutation
 * to invalidate.
 *
 * `revalidatePath("/", "layout")` used to sit at the end of each of these. It
 * purged every prerendered page in the app — both home pages and every
 * category page — on every single add to cart. The next visitor then paid for
 * the regeneration, which is what made the site feel like it was hanging.
 */
export async function addToCartAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const qty = Math.max(1, Math.min(99999, Number(formData.get("qty")) || 1));
  if (!Number.isFinite(productId) || productId <= 0) return;
  await addLine(productId, qty);
}

export async function updateQtyAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const qty = Number(formData.get("qty"));
  if (!Number.isFinite(productId)) return;
  await setLineQty(productId, Math.min(99999, qty));
}

export async function removeLineAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  if (!Number.isFinite(productId)) return;
  await removeLine(productId);
}

export type QuickOrderResult = {
  added: { partNumber: string; qty: number }[];
  notFound: string[];
};

/**
 * Parses pasted "part-number, qty" lines. Buyers paste out of spreadsheets, so
 * commas, tabs, and runs of spaces all count as the separator, and a line with
 * no quantity means one.
 */
export async function quickOrderAction(
  _prev: QuickOrderResult | null,
  formData: FormData,
): Promise<QuickOrderResult> {
  const raw = String(formData.get("lines") ?? "");
  const parsed: { pn: string; qty: number }[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,\t]+|\s{2,}|\s+(?=\d+$)/).map((p) => p.trim()).filter(Boolean);
    const pn = parts[0];
    if (!pn) continue;
    const qty = Math.max(1, Math.min(99999, Number(parts[1]) || 1));
    parsed.push({ pn, qty });
  }

  if (parsed.length === 0) return { added: [], notFound: [] };

  const found = await findByPartNumbers(parsed.map((p) => p.pn));
  const byPn = new Map(found.map((f) => [f.partNumber.toUpperCase(), f]));

  const added: { partNumber: string; qty: number }[] = [];
  const notFound: string[] = [];

  for (const { pn, qty } of parsed) {
    const hit = byPn.get(pn.toUpperCase());
    if (!hit) {
      notFound.push(pn);
      continue;
    }
    await addLine(hit.id, qty);
    added.push({ partNumber: hit.partNumber, qty });
  }

  return { added, notFound };
}

/** Six characters from an unambiguous alphabet — no O/0 or I/1 to misread aloud. */
function quoteRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `ORD-${out}`;
}

export async function submitQuoteAction(formData: FormData) {
  const locale = safeLocale(formData);
  const lines = await getCartLines();
  if (lines.length === 0) redirect(`/${locale}/cart`);

  // Phone is required too: sales chases quotes by phone, and the HTML
  // `required` attribute is trivially bypassed, so the check has to live here.
  const required = ["company", "contactName", "email", "phone"];
  for (const field of required) {
    if (!String(formData.get(field) ?? "").trim()) {
      redirect(`/${locale}/quote?error=missing`);
    }
  }

  const totalCents = lines.reduce((sum, l) => sum + unitPriceAt(l, l.qty) * l.qty, 0);
  const ref = quoteRef();
  // Guest checkout stays supported, so this is nullable. A guest's typed
  // address is deliberately NOT matched against an existing account: without
  // email verification that would let anyone attach a stranger's order to
  // themselves by typing their address.
  const userId = await currentUserId();

  // Header and line items go in one transaction. Without it, a failure partway
  // through leaves a quote whose line items are missing while the cart is still
  // full — the buyer resubmits and sales receives two conflicting requests for
  // the same order.
  await sql.begin(async (tx) => {
    const [order] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, phone, po_number,
                          address, city, country, notes, locale, currency,
                          total_cents, requested_total_cents, status, user_id)
      VALUES (
        ${ref},
        ${String(formData.get("company") ?? "")},
        ${String(formData.get("contactName") ?? "")},
        ${String(formData.get("email") ?? "")},
        ${String(formData.get("phone") ?? "")},
        ${String(formData.get("poNumber") ?? "")},
        ${String(formData.get("address") ?? "")},
        ${String(formData.get("city") ?? "")},
        ${String(formData.get("country") ?? "")},
        ${String(formData.get("notes") ?? "")},
        ${locale},
        ${locale === "fa" ? "IRT" : "USD"},
        ${totalCents},
        ${totalCents},
        'received',
        ${userId}
      )
      RETURNING id
    `;

    // Snapshot names, specs and prices so a later catalog edit cannot rewrite an
    // order that has already been sent to the buyer.
    for (const l of lines) {
      await tx`
        INSERT INTO order_items (order_id, product_id, part_number, family_name,
                                 specs_snapshot, qty, unit_price_cents,
                                 requested_unit_price_cents)
        VALUES (${order.id}, ${l.productId}, ${l.partNumber},
                ${locale === "fa" ? l.familyFa : l.familyEn},
                -- Serialise explicitly and cast: passing the object straight
                -- through leaves postgres-js guessing at the parameter type.
                ${JSON.stringify(l.specs)}::jsonb,
                ${l.qty}, ${unitPriceAt(l, l.qty)}, ${unitPriceAt(l, l.qty)})
      `;
    }

    // Inside the same transaction as the lines it reserves against. A hold
    // recorded without its order, or an order without its hold, is worse than
    // either failing outright.
    await holdStockForOrder(tx, order.id);
  });

  await clearCart();
  // No revalidation here either: the hold this places changes inventory, and
  // inventory appears only on /admin/products, which is rendered on demand.
  // redirect() throws to unwind, so it must sit outside the transaction.
  redirect(`/${locale}/quote/submitted?ref=${ref}`);
}
