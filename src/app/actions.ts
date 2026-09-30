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
import { isLocale, safeLocale, type Locale } from "@/lib/i18n";
import { currentUserId } from "@/lib/session";
import { AUTH_SECRET } from "@/lib/authSecret";
import { verifyQuoteSubmissionToken } from "@/lib/quoteSubmission";
import { submitOrderFromCart } from "@/db/orderSubmissionQueries";
import { parseContact } from "@/lib/quoteContact";
import { currentRep } from "@/lib/repSession";
import type { RepRow } from "@/db/repQueries";
import { getCustomerForRep } from "@/db/customerQueries";
import { clearOrderingFor } from "@/lib/repOrderContext";
import { isUuid } from "@/lib/ids";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { boundedString, parseQuickOrder } from "@/lib/requestLimits";
import { getPriceDisplayMode } from "@/lib/fx";
import { customerCurrencyFor } from "@/lib/money";

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
  // A signed-in rep orders for a customer; that path owns its own limit,
  // customer check and landing page.
  const rep = await currentRep();
  if (rep) return submitForCustomer(rep, locale, formData);
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

  // Guest checkout stays supported, so userId is nullable. A guest's typed
  // address is deliberately NOT matched against an existing account: without
  // email verification that would let anyone attach a stranger's order to
  // themselves by typing their address. The email is required only from a
  // guest — a signed-in customer's order sits on their account.
  const parsed = parseContact(formData, userId === null);
  if ("error" in parsed) redirect(`/${locale}/quote?error=${parsed.error}`);
  const contact = parsed.contact;

  const currency = customerCurrencyFor(await getPriceDisplayMode(), locale);
  const result = await submitOrderFromCart({
    cartId,
    cartFingerprint: token.cartFingerprint,
    submissionKey: token.submissionKey,
    locale,
    currency,
    userId,
    placedByRepId: null,
    contact,
  });

  if (result.kind === "cart-changed") {
    redirect(`/${locale}/quote?error=cart-changed`);
  }
  if (result.kind === "empty-cart" || result.kind === "missing-cart") {
    redirect(`/${locale}/cart`);
  }
  // Only a rep's order can be refused this way; kept so the handling stays
  // exhaustive if this path ever passes a rep.
  if (result.kind === "customer-moved") redirect(`/${locale}/quote?error=invalid`);
  if (result.kind === "too-large") redirect(`/${locale}/quote?error=too-large`);

  // The order, item snapshots, stock hold and cart clear have all committed at
  // this point. A replay returns the same reference through the same redirect.
  redirect(`/${locale}/quote/submitted?ref=${result.ref}`);
}

/**
 * A rep placing an order for one of their customers: its own rate limit
 * (reps legitimately place many orders), the customer re-checked against the
 * session, the order in the customer's language, and the rep landing on the
 * order with its pay link rather than on the customer's confirmation page.
 */
async function submitForCustomer(rep: RepRow, locale: Locale, formData: FormData): Promise<void> {
  if (rep.mustChangePassword) redirect(`/${locale}/rep/password`);
  const limit = await consumeRateLimit("rep:order", RATE_LIMITS.repOrderSubmit, { accountId: rep.id });
  if (!limit.allowed) redirect(`/${locale}/quote?error=rate-limit`);

  const token = verifyQuoteSubmissionToken(
    boundedString(formData.get("submissionToken"), 2_000) ?? "",
    AUTH_SECRET,
  );
  const cartId = await getCartId();
  if (!cartId) redirect(`/${locale}/cart`);
  if (!token || token.cartId !== cartId) redirect(`/${locale}/quote?error=expired`);

  const customerId = String(formData.get("forCustomerId") ?? "");
  const customer = isUuid(customerId) ? await getCustomerForRep(rep.id, customerId) : null;
  if (!customer) redirect(`/${locale}/quote?error=customer`);
  const again = `/${locale}/quote?for=${customer.id}`;

  const parsed = parseContact(formData, false);
  if ("error" in parsed) redirect(`${again}&error=${parsed.error}`);

  const orderLocale: Locale = isLocale(customer.locale) ? customer.locale : locale;
  const result = await submitOrderFromCart({
    cartId,
    cartFingerprint: token.cartFingerprint,
    submissionKey: token.submissionKey,
    locale: orderLocale,
    currency: customerCurrencyFor(await getPriceDisplayMode(), orderLocale),
    userId: customer.id,
    placedByRepId: rep.id,
    contact: parsed.contact,
  });
  if (result.kind === "customer-moved") redirect(`/${locale}/quote?error=customer`);
  if (result.kind === "too-large") redirect(`${again}&error=too-large`);
  if (result.kind === "cart-changed") redirect(`${again}&error=cart-changed`);
  if (result.kind === "empty-cart" || result.kind === "missing-cart") redirect(`/${locale}/cart`);

  await clearOrderingFor();
  redirect(`/${locale}/rep/orders/${result.ref}?ok=created`);
}
