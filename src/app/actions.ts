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
import { currentUser } from "@/lib/session";
import { AUTH_SECRET } from "@/lib/authSecret";
import { verifyQuoteSubmissionToken } from "@/lib/quoteSubmission";
import { submitOrderFromCart } from "@/db/orderSubmissionQueries";
import { parseContact } from "@/lib/quoteContact";
import { currentRep } from "@/lib/repSession";
import type { RepRow } from "@/db/repQueries";
import { getOrderableCustomerForRep } from "@/db/customerQueries";
import { clearOrderingFor } from "@/lib/repOrderContext";
import { isUuid } from "@/lib/ids";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { boundedString, parseQuickOrder } from "@/lib/requestLimits";
import { getPriceDisplayMode } from "@/lib/fx";
import { customerCurrencyFor } from "@/lib/money";
import { parseCheckoutMode } from "@/lib/checkoutSplit";
import { notifyOrdersPlaced, pishFactorTerms, runExpirySweep } from "@/lib/orderFlow";
import { addAddress, getAddress } from "@/db/addressQueries";
import { createUser, findUserIdByEmail } from "@/db/userQueries";
import { unusablePasswordHash } from "@/lib/password";
import { readReferralCode } from "@/lib/referral";
import { getActiveRepByReferralCode } from "@/db/repQueries";

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

/**
 * Checkout. A cart that is all priced and on the shelf becomes an order with
 * its pish-factor issued in the same transaction; anything else becomes a
 * request staff answer, or one of each (lib/checkoutSplit.ts decides, the
 * order transaction re-decides under row locks).
 */
export async function submitQuoteAction(formData: FormData) {
  const locale = safeLocale(formData);
  // A signed-in rep orders for a customer; that path owns its own limit,
  // customer check and landing page.
  const rep = await currentRep();
  if (rep) return submitForCustomer(rep, locale, formData);
  const user = await currentUser();
  const limit = await consumeRateLimit("quote:submit", RATE_LIMITS.quoteSubmit, {
    accountId: user?.id ?? null,
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

  // A signed-in customer may deliver to a saved address: its fields replace
  // whatever the address inputs held, before anything is validated. Read with
  // the session's user id, so a posted id that is someone else's is ignored.
  const choice = String(formData.get("addressChoice") ?? "");
  const saved = user && isUuid(choice) ? await getAddress(user.id, choice) : null;
  if (saved) {
    formData.set("address", saved.address);
    formData.set("city", saved.city);
    formData.set("postalCode", saved.postalCode);
  }

  // The email is required only from a guest: it is where the pish-factor goes
  // and what their account is made from. A signed-in customer's is on file.
  const parsed = parseContact(formData, user === null);
  if ("error" in parsed) redirect(`/${locale}/quote?error=${parsed.error}`);
  const contact = parsed.contact;
  if (user && contact.email === "") contact.email = user.email ?? "";

  // A guest's order goes on an account: the one their email already has, or
  // a new one made from what they just typed. Attaching to an existing
  // account by typed email used to be refused, because nothing proved the
  // typist owned the address. It is safe now for a different reason: the
  // order's pish-factor is emailed only to that address, this browser is not
  // signed in to anything, and the account itself opens only by a code sent
  // to the same inbox. Whoever typed it learns nothing about the account.
  let userId = user?.id ?? null;
  let createdAccount = false;
  if (userId === null) {
    userId = await findUserIdByEmail(contact.email);
    if (userId === null) {
      const referralCode = await readReferralCode();
      const referrer = referralCode ? await getActiveRepByReferralCode(referralCode) : null;
      const created = await createUser({
        email: contact.email,
        passwordHash: await unusablePasswordHash(),
        company: contact.company,
        contactName: contact.contactName,
        phone: contact.phone,
        locale,
        origin: referrer ? "referral" : "checkout",
        repId: referrer?.id ?? null,
        accountNumber: "assigned",
      });
      // Lost a race with the same address: the other request made it.
      userId = created === "email-taken" ? await findUserIdByEmail(contact.email) : created.id;
      createdAccount = created !== "email-taken";
    }
  }

  // Deadlines first, so the shelf this order reads has had every lapsed
  // pish-factor's stock put back.
  await runExpirySweep({ force: true });
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
    mode: parseCheckoutMode(formData.get("mode")),
    pishFactor: await pishFactorTerms(),
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
  // this point. A replay returns the same order through the same redirect —
  // and sends nothing twice.
  if (result.kind === "created") {
    // The address a new account, or a signed-in customer who asked, keeps.
    const keep = createdAccount || (user !== null && !saved && formData.get("saveAddress") === "on");
    if (userId && keep) {
      await addAddress(userId, {
        label: "",
        recipient: contact.contactName,
        phone: contact.phone,
        address: contact.address,
        city: contact.city,
        postalCode: contact.postalCode,
      });
    }
    await notifyOrdersPlaced(result.orders);
  }
  redirect(`/${locale}/pay/${result.payToken}?placed=1`);
}

/**
 * A rep placing an order for one of their customers: its own rate limit
 * (reps legitimately place many orders), the customer re-checked against the
 * session, the order in the customer's language, and the rep landing on the
 * order with its pay link rather than on the customer's confirmation page.
 * The same split applies: what is priced and on the shelf gets its
 * pish-factor at once, emailed to the customer if they have an address.
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
  const found = isUuid(customerId) ? await getOrderableCustomerForRep(rep.id, customerId) : null;
  // Someone else's customer is refused like an unknown id: the same error, so
  // a posted id tells a rep nothing about who owns it.
  if (!found || found.kind === "taken") redirect(`/${locale}/quote?error=customer`);
  const customer = found.customer;
  const again = `/${locale}/quote?for=${customer.id}`;

  // A saved delivery address replaces the address inputs, read with the
  // customer's id (an unassigned customer's addresses are what the rep was
  // shown), so a posted id that is someone else's matches nothing.
  const choice = String(formData.get("addressChoice") ?? "");
  const savedAddress = isUuid(choice) ? await getAddress(customer.id, choice) : null;
  if (savedAddress) {
    formData.set("address", savedAddress.address);
    formData.set("city", savedAddress.city);
    formData.set("postalCode", savedAddress.postalCode);
  }

  // The form for an unassigned customer carries neither their email nor a PO
  // number, so the fields are missing rather than empty. The pish-factor still
  // goes to the address on file, which stays on the server.
  if (!formData.has("email")) formData.set("email", customer.email ?? "");
  if (!formData.has("poNumber")) formData.set("poNumber", "");
  const parsed = parseContact(formData, false);
  if ("error" in parsed) redirect(`${again}&error=${parsed.error}`);

  await runExpirySweep({ force: true });
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
    mode: parseCheckoutMode(formData.get("mode")),
    pishFactor: await pishFactorTerms(),
  });
  if (result.kind === "customer-moved") redirect(`/${locale}/quote?error=customer`);
  if (result.kind === "too-large") redirect(`${again}&error=too-large`);
  if (result.kind === "cart-changed") redirect(`${again}&error=cart-changed`);
  if (result.kind === "empty-cart" || result.kind === "missing-cart") redirect(`/${locale}/cart`);

  if (result.kind === "created") await notifyOrdersPlaced(result.orders);
  await clearOrderingFor();
  redirect(`/${locale}/rep/orders/${result.ref}?ok=created`);
}
