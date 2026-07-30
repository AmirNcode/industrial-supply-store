"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { addLine, setLineQty, removeLine, clearCart, getCartLines, unitPriceAt } from "@/lib/cart";
import { findByPartNumbers } from "@/db/queries";
import type { Locale } from "@/lib/i18n";

export async function addToCartAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const qty = Math.max(1, Math.min(99999, Number(formData.get("qty")) || 1));
  if (!Number.isFinite(productId) || productId <= 0) return;
  await addLine(productId, qty);
  revalidatePath("/", "layout");
}

export async function updateQtyAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const qty = Number(formData.get("qty"));
  if (!Number.isFinite(productId)) return;
  await setLineQty(productId, Math.min(99999, qty));
  revalidatePath("/", "layout");
}

export async function removeLineAction(formData: FormData) {
  const productId = Number(formData.get("productId"));
  if (!Number.isFinite(productId)) return;
  await removeLine(productId);
  revalidatePath("/", "layout");
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

  revalidatePath("/", "layout");
  return { added, notFound };
}

/** Six characters from an unambiguous alphabet — no O/0 or I/1 to misread aloud. */
function quoteRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RFQ-${out}`;
}

export async function submitQuoteAction(formData: FormData) {
  const locale = (String(formData.get("locale") || "en") as Locale) ?? "en";
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

  // Header and line items go in one transaction. Without it, a failure partway
  // through leaves a quote whose line items are missing while the cart is still
  // full — the buyer resubmits and sales receives two conflicting requests for
  // the same order.
  await sql.begin(async (tx) => {
    const [quote] = await tx<{ id: number }[]>`
      INSERT INTO quotes (ref, company, contact_name, email, phone, po_number,
                          address, city, country, notes, locale, currency, total_cents)
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
        ${totalCents}
      )
      RETURNING id
    `;

    // Snapshot names, specs and prices so a later catalog edit cannot rewrite a
    // quote that has already been sent to the buyer.
    for (const l of lines) {
      await tx`
        INSERT INTO quote_items (quote_id, product_id, part_number, family_name,
                                 specs_snapshot, qty, unit_price_cents)
        VALUES (${quote.id}, ${l.productId}, ${l.partNumber},
                ${locale === "fa" ? l.familyFa : l.familyEn},
                -- Serialise explicitly and cast: passing the object straight
                -- through leaves postgres-js guessing at the parameter type.
                ${JSON.stringify(l.specs)}::jsonb,
                ${l.qty}, ${unitPriceAt(l, l.qty)})
      `;
    }
  });

  await clearCart();
  revalidatePath("/", "layout");
  // redirect() throws to unwind, so it must sit outside the transaction.
  redirect(`/${locale}/quote/submitted?ref=${ref}`);
}
