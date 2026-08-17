"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  CartCapacityError,
  addLines,
  setLineQty,
  removeLine,
  getCartId,
} from "@/lib/cart";
import { findByPartNumbers } from "@/db/queries";
import { safeLocale } from "@/lib/i18n";
import { currentUserId } from "@/lib/session";
import { AUTH_SECRET } from "@/lib/authSecret";
import { verifyQuoteSubmissionToken } from "@/lib/quoteSubmission";
import { submitOrderFromCart, type QuoteContact } from "@/db/orderSubmissionQueries";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import {
  REQUEST_LIMITS,
  boundedString,
  parseQuickOrder,
} from "@/lib/requestLimits";

/**
 * Revalidation is scoped to the cart page only.
 *
 * `revalidatePath("/", "layout")` used to sit at the end of each of these. It
 * purged every prerendered page in the app — both home pages and every
 * category page — on every single add to cart. The next visitor then paid for
 * the regeneration, which is what made the site feel like it was hanging.
 *
 * But dropping revalidation entirely broke the one server-rendered view of the
 * cart: /[locale]/cart renders its lines on the server, and a server action
 * that revalidates nothing, sets no cookie and does not redirect returns no
 * updated UI — Update and Remove mutated the row and left the page exactly as
 * it was until a manual refresh. `CartBadge` and `InCartQty` are unaffected
 * either way; they render from the client copy `CartSync` pulls from
 * /api/cart. The cart page is dynamic (it reads the cart cookie), so this
 * revalidate purges no prerendered page.
 */
export async function updateQtyAction(formData: FormData) {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("cart:write", RATE_LIMITS.cartWrite);
  if (!limit.allowed) redirect(`/${locale}/cart?error=rate-limit`);

  const productId = Number(formData.get("productId"));
  const qty = Number(formData.get("qty"));
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isFinite(qty)) return;
  await setLineQty(productId, Math.min(99999, qty));
  revalidatePath("/[locale]/cart", "page");
}

export async function removeLineAction(formData: FormData) {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("cart:write", RATE_LIMITS.cartWrite);
  if (!limit.allowed) redirect(`/${locale}/cart?error=rate-limit`);

  const productId = Number(formData.get("productId"));
  if (!Number.isSafeInteger(productId) || productId <= 0) return;
  await removeLine(productId);
  revalidatePath("/[locale]/cart", "page");
}

export type QuickOrderResult = {
  added: { partNumber: string; qty: number }[];
  notFound: string[];
  error?: "too-large" | "rate-limit" | "cart-full";
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
  const limit = await consumeRateLimit("quick-order:submit", RATE_LIMITS.quickOrder);
  if (!limit.allowed) return { added: [], notFound: [], error: "rate-limit" };

  const parsed = parseQuickOrder(formData.get("lines"));
  if (!parsed.ok) return { added: [], notFound: [], error: parsed.reason };
  if (parsed.lines.length === 0) return { added: [], notFound: [] };

  // Repeated part numbers from a pasted sheet are one cart mutation and one
  // result row, with their requested quantities accumulated safely.
  const requested = new Map<string, { partNumber: string; qty: number }>();
  for (const line of parsed.lines) {
    const key = line.partNumber.toUpperCase();
    const previous = requested.get(key);
    requested.set(key, {
      partNumber: previous?.partNumber ?? line.partNumber,
      qty: Math.min(99_999, (previous?.qty ?? 0) + line.qty),
    });
  }

  const found = await findByPartNumbers([...requested.values()].map((line) => line.partNumber));
  const byPn = new Map(found.map((f) => [f.partNumber.toUpperCase(), f]));

  const added: { partNumber: string; qty: number }[] = [];
  const notFound: string[] = [];
  const writes: { productId: number; qty: number }[] = [];

  for (const [key, line] of requested) {
    const hit = byPn.get(key);
    if (!hit) {
      notFound.push(line.partNumber);
      continue;
    }
    writes.push({ productId: hit.id, qty: line.qty });
    added.push({ partNumber: hit.partNumber, qty: line.qty });
  }

  try {
    await addLines(writes);
  } catch (error) {
    if (error instanceof CartCapacityError) {
      return { added: [], notFound, error: "cart-full" };
    }
    throw error;
  }

  return { added, notFound };
}

export async function submitQuoteAction(formData: FormData) {
  const locale = safeLocale(formData);
  const userId = await currentUserId();
  const limit = await consumeRateLimit("quote:submit", RATE_LIMITS.quoteSubmit, {
    accountId: userId,
  });
  if (!limit.allowed) redirect(`/${locale}/quote?error=rate-limit`);

  const submittedToken = boundedString(formData.get("submissionToken"), 2_000);
  const token = verifyQuoteSubmissionToken(
    submittedToken ?? "",
    AUTH_SECRET,
  );
  const cartId = await getCartId();
  if (!cartId) redirect(`/${locale}/cart`);
  if (!token || token.cartId !== cartId) {
    redirect(`/${locale}/quote?error=expired`);
  }

  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(
    formData.get("contactName"),
    REQUEST_LIMITS.contactNameChars,
  );
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars)?.toLowerCase();
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);
  if (!company || !contactName || !email || !phone) {
    redirect(`/${locale}/quote?error=missing`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/${locale}/quote?error=invalid`);
  }

  const optional = (name: string, maxChars: number) =>
    boundedString(formData.get(name), maxChars, { allowEmpty: true });
  const poNumber = optional("poNumber", REQUEST_LIMITS.poNumberChars);
  const address = optional("address", REQUEST_LIMITS.addressChars);
  const city = optional("city", REQUEST_LIMITS.cityChars);
  const country = optional("country", REQUEST_LIMITS.countryChars);
  const notes = optional("notes", REQUEST_LIMITS.notesChars);
  if ([poNumber, address, city, country, notes].some((value) => value === null)) {
    redirect(`/${locale}/quote?error=invalid`);
  }

  // Guest checkout stays supported, so this is nullable. A guest's typed
  // address is deliberately NOT matched against an existing account: without
  // email verification that would let anyone attach a stranger's order to
  // themselves by typing their address.
  const contact: QuoteContact = {
    company,
    contactName,
    email,
    phone,
    poNumber: poNumber!,
    address: address!,
    city: city!,
    country: country!,
    notes: notes!,
  };

  const result = await submitOrderFromCart({
    cartId,
    cartFingerprint: token.cartFingerprint,
    submissionKey: token.submissionKey,
    locale,
    userId,
    contact,
  });

  if (result.kind === "cart-changed") {
    redirect(`/${locale}/quote?error=cart-changed`);
  }
  if (result.kind === "empty-cart" || result.kind === "missing-cart") {
    redirect(`/${locale}/cart`);
  }

  // The order, item snapshots, stock hold and cart clear have all committed at
  // this point. A replay returns the same reference through the same redirect.
  redirect(`/${locale}/quote/submitted?ref=${result.ref}`);
}
