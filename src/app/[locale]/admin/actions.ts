"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { assertAdminWrite, signInAdmin, signOutAdmin, signOutAllAdmins } from "@/lib/admin";
import { getAutomaticRate, getFxRate, saveFxSettings, savePriceDisplayMode } from "@/lib/fx";
import { isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";
import { refreshMarketRate } from "@/lib/fxMarketUpdate";
import { safeLocale } from "@/lib/i18n";
import { saveSiteContact } from "@/lib/siteContact";
import { validateBankFields } from "@/lib/bankDetails";
import { saveBankFields } from "@/lib/bankSettings";
import {
  normalizeContactEmail,
  normalizeContactPhone,
} from "@/lib/siteContactValues";
import { HELD_STATUSES, assertTransition, isOrderStatus } from "@/lib/orders";
import { addComment } from "@/db/commentQueries";
import { releaseHeldStock } from "@/db/inventoryQueries";
import { confirmPayment } from "@/db/paymentProofQueries";
import { RATE_LIMITS, consumeGlobalRateLimit, consumeRateLimit } from "@/lib/rateLimit";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { issueInvoice } from "@/db/invoiceQueries";
import { getPayLinkParts, replacePayToken } from "@/db/payLinkQueries";
import { siteOrigin } from "@/lib/siteOrigin";
import { isPriceDisplayMode } from "@/lib/money";
import { draftQuery, parsePriceDollars, priceParamName } from "@/lib/invoiceDraft";
import { parseVatPercent } from "@/lib/vat";
import { getVatRateBp, saveVatRateBp } from "@/lib/vatSettings";

/**
 * Signing in and out live here, alongside every other admin action, so
 * `safeLocale` has exactly one definition. Both used to be defined inline in
 * `page.tsx` with a raw `formData.get("locale")` interpolated straight into
 * `redirect()` — the same open-redirect shape `safeLocale` exists to close,
 * just missed because these two predate it.
 *
 * Neither calls `assertAdminWrite()`: it would be circular for `loginAction`
 * (the whole point is to become the admin that check requires), and
 * `logoutAction` must stay reachable to clear a cookie regardless of whether
 * the session backing it is still valid.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const [limit, global] = await Promise.all([
    consumeRateLimit("admin:sign-in", RATE_LIMITS.adminLogin),
    consumeGlobalRateLimit("admin:sign-in-all", RATE_LIMITS.adminLoginGlobal),
  ]);
  if (!limit.allowed || !global.allowed) redirect(`/${locale}/admin/login?error=rate-limit`);
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const ok = password ? await signInAdmin(password) : false;
  // A failure returns to the form rather than to /admin, which would only
  // bounce straight back here and lose the error message on the way.
  redirect(ok ? `/${locale}/admin` : `/${locale}/admin/login?error=1`);
}

export async function logoutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await signOutAdmin();
  // Straight to the form. /admin would redirect to /admin/orders, which would
  // redirect back here anyway now the cookie is gone — three hops to land in
  // the same place.
  redirect(`/${locale}/admin/login`);
}

/**
 * Ends every admin session on every device, including this one. With one
 * shared password this is the only way to revoke a cookie that may have been
 * copied; changing ADMIN_PASSWORD does the same.
 */
export async function signOutEverywhereAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  await signOutAllAdmins();
  redirect(`/${locale}/admin/login`);
}

export async function saveFxAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const rawMode = String(formData.get("mode") ?? "auto");
  const mode = isFxMode(rawMode) ? rawMode : "auto";

  let manualRate: number | null = null;
  if (mode === "manual") {
    const parsed = parseRate(String(formData.get("rate") ?? ""));
    if (parsed === null) redirect(`/${locale}/admin/settings?fx=invalid`);
    // Judged against the rate automatic mode would use, which is what the
    // warning names and what the admin can see beside the field.
    if (!isPlausibleRate(parsed, await getAutomaticRate())) {
      redirect(`/${locale}/admin/settings?fx=range`);
    }
    manualRate = parsed;
  }

  await saveFxSettings(mode, manualRate);
  // The catalog is statically rendered with revalidate = 3600, so without this
  // a rate change would take up to an hour to reach the pages that show it.
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/settings?fx=saved`);
}

/**
 * Run the evening market job now.
 *
 * For a missed evening, or to see a first reading without waiting for one.
 * It reprices only in automatic mode — manual mode ignores the market rate —
 * and, like the job, it purges nothing: every priced page reads the rate as it
 * renders, and the settings page this redirects to is rendered per request.
 */
export async function refreshFxRateAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const result = await refreshMarketRate();
  redirect(`/${locale}/admin/settings?fx=${result.ok ? "refreshed" : "refresh-failed"}`);
}

export async function savePriceDisplayModeAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const rawMode = String(formData.get("priceDisplayMode") ?? "");
  if (!isPriceDisplayMode(rawMode)) {
    redirect(`/${locale}/admin/settings?currency=invalid`);
  }

  await savePriceDisplayMode(rawMode);
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/settings?currency=saved`);
}

export async function saveSiteContactAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const email = normalizeContactEmail(String(formData.get("email") ?? ""));
  if (!email) redirect(`/${locale}/admin/settings?contact=invalid-email`);

  const phone = normalizeContactPhone(String(formData.get("phone") ?? ""));
  if (!phone) redirect(`/${locale}/admin/settings?contact=invalid-phone`);

  await saveSiteContact(email, phone);
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin/settings?contact=saved`);
}

/**
 * Appends the queue filter the staff member was viewing (e.g.
 * `?status=preparing`) to a redirect target, so acting on an order from a
 * filtered view returns them to that same view instead of bouncing them to
 * the default "needs action" queue. A blank or otherwise invalid value —
 * including the empty string a form posts when no filter was active — is
 * dropped rather than forwarded.
 */
function withFilter(url: string, statusFilter: string): string {
  return isOrderStatus(statusFilter) ? `${url}&status=${statusFilter}` : url;
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const statusFilter = String(formData.get("statusFilter") ?? "");
  const id = Number(formData.get("orderId"));
  const to = String(formData.get("status") ?? "");
  if (!Number.isInteger(id) || id <= 0 || !isOrderStatus(to)) {
    redirect(withFilter(`/${locale}/admin/orders?error=bad-request`, statusFilter));
  }

  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!row || !isOrderStatus(row.status)) {
    redirect(withFilter(`/${locale}/admin/orders?error=not-found`, statusFilter));
  }

  // Throws rather than redirecting: reaching here with an illegal pair means a
  // hand-crafted post or a bug, not a mistake a form can make.
  assertTransition(row.status, to);

  // One explicit statement per destination. A single query with an
  // interpolated column name would be shorter and much harder to read at the
  // one place in this codebase that decides whether goods have shipped.
  //
  // Each UPDATE below also repeats `AND status = ${row.status}` rather than
  // trusting the SELECT above. Between that read and this write, a concurrent
  // submission — a double-click, or two staff on the same order — can change
  // the row. The predicate, not the earlier read, is what makes the guard
  // atomic: the read only established what the status *was*, and can be stale
  // by the time this statement runs. `result.count === 0` then means this
  // statement lost that race, and the order is left exactly as whoever won it
  // left it.
  if (to === "shipped") {
    const courier = String(formData.get("courier") ?? "").trim();
    const tracking = String(formData.get("trackingNumber") ?? "").trim();
    // The whole point of this state is showing the customer a tracking number.
    if (!courier || !tracking) {
      redirect(withFilter(`/${locale}/admin/orders?error=tracking`, statusFilter));
    }
    const result = await sql`
      UPDATE orders
      SET status = 'shipped', courier = ${courier},
          tracking_number = ${tracking}, shipped_at = now()
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));
    }
  } else if (to === "preparing") {
    // Payment turns the reservation into a sale, so the count move and the
    // status move go together or neither happens (`confirmPayment`). From
    // `invoiced` this is the admin confirming a payment made without an
    // upload; from `payment_review`, confirming the receipts. `assertTransition`
    // above already limits `row.status` to those two.
    const moved = await confirmPayment(id, row.status as "invoiced" | "payment_review");
    if (!moved) {
      redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));
    }
  } else if (to === "delivered") {
    const result = await sql`
      UPDATE orders SET status = 'delivered', delivered_at = now()
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));
    }
  } else if (to === "cancelled") {
    // Only an order still holding stock puts any back. Cancelling something
    // already paid for would need a refund path, which does not exist yet, so
    // the released quantity is decided by the status being left, not the one
    // being entered.
    const stillHeld = (HELD_STATUSES as readonly string[]).includes(row.status);
    const moved = await sql.begin(async (tx) => {
      const result = await tx`
        UPDATE orders SET status = 'cancelled'
        WHERE id = ${id} AND status = ${row.status}
      `;
      if (result.count === 0) return false;
      if (stillHeld) await releaseHeldStock(tx, id);
      return true;
    });
    if (!moved) {
      redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));
    }
  } else {
    // 'received' and 'invoiced' are not reachable here: nothing transitions to
    // 'received', and 'invoiced' belongs to issueInvoice, which prices the
    // order and locks its exchange and VAT rates.
    redirect(withFilter(`/${locale}/admin/orders?error=bad-request`, statusFilter));
  }

  // No revalidation: an order's status appears only on /admin/orders, /track,
  // /account and the invoice, none of which are cached.
  redirect(withFilter(`/${locale}/admin/orders?ok=status`, statusFilter));
}

/**
 * Finalize the draft the admin has just checked: price the order, number the
 * invoice, and lock the exchange rate and VAT rate (`issueInvoice`).
 *
 * The draft showed a rate and a VAT rate. If either has moved since — the
 * evening market job, or someone saving Settings in another tab — the invoice
 * would lock figures nobody looked at, so it goes back to the draft, updated,
 * instead. The prices come from the draft's own form, parsed by the same rule
 * the draft used, so what was shown is what is written.
 */
export async function issueInvoiceAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const statusFilter = String(formData.get("statusFilter") ?? "");
  const id = Number(formData.get("orderId"));
  if (!Number.isInteger(id) || id <= 0) {
    redirect(withFilter(`/${locale}/admin/orders?error=bad-request`, statusFilter));
  }

  const [order] = await sql<{ status: string; ref: string }[]>`
    SELECT status, ref FROM orders WHERE id = ${id}
  `;
  if (!order || !isOrderStatus(order.status)) {
    redirect(withFilter(`/${locale}/admin/orders?error=not-found`, statusFilter));
  }
  // A rep can invoice the same order while this draft is open, so an order
  // already past `received` is a lost race, not a forged post.
  if (order.status !== "received") {
    redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));
  }

  const [itemRows, rate, vatRateBp] = await Promise.all([
    sql<{ id: number }[]>`
      SELECT id FROM order_items WHERE order_id = ${id} ORDER BY id
    `,
    getFxRate(),
    getVatRateBp(),
  ]);

  // Parse every price before writing anything, so a bad value on the last line
  // cannot leave the order half-priced.
  const prices = new Map<number, number>();
  for (const row of itemRows) {
    const cents = parsePriceDollars(formData.get(priceParamName(row.id)));
    if (cents === null) {
      redirect(withFilter(`/${locale}/admin/orders?error=prices`, statusFilter));
    }
    prices.set(row.id, cents);
  }

  if (Number(formData.get("rate")) !== rate || Number(formData.get("vatRateBp")) !== vatRateBp) {
    const query = draftQuery(prices, {
      statusFilter,
      cur: String(formData.get("cur") ?? ""),
      changed: "1",
    });
    redirect(`/${locale}/admin/orders/${order.ref}/invoice?${query}`);
  }

  const issued = await issueInvoice(id, {
    rate,
    vatRateBp,
    prices: [...prices].map(([lineId, cents]) => ({ id: lineId, cents })),
  });
  if (issued === "unpriced") redirect(withFilter(`/${locale}/admin/orders?error=prices`, statusFilter));
  if (issued === "conflict") redirect(withFilter(`/${locale}/admin/orders?error=conflict`, statusFilter));

  // Invoicing changes an order, and no cached page renders orders.
  redirect(withFilter(`/${locale}/admin/orders?ok=invoiced`, statusFilter));
}

/**
 * The VAT rate the next invoice will carry. Invoices already issued keep the
 * rate locked onto them, so this never restates one.
 */
export async function saveVatRateAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const bp = parseVatPercent(String(formData.get("vatRate") ?? ""));
  if (bp === null) redirect(`/${locale}/admin/settings?vat=invalid#vat`);
  await saveVatRateBp(bp);
  // No revalidation: VAT appears only on invoices, drafts and order pages,
  // every one of them rendered per request.
  redirect(`/${locale}/admin/settings?vat=saved#vat`);
}

/**
 * One order's pay link, returned to the admin who pressed "Show pay link".
 *
 * The queue does not render the links itself: a pay link is a bearer
 * credential for its order (upload receipts, open the invoice), and a page
 * listing two hundred of them is two hundred keys in one copy-paste. Behind
 * `assertAdminWrite`, so the public demo's read-only panel never hands one out.
 */
export async function payLinkForOrderAction(orderId: number): Promise<string | null> {
  await assertAdminWrite();
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  const parts = await getPayLinkParts(orderId);
  if (!parts) return null;
  return `${await siteOrigin()}/${parts.locale}/pay/${parts.token}`;
}

/** A new pay link for one order; the old one stops working at once. */
export async function replacePayLinkAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const statusFilter = String(formData.get("statusFilter") ?? "");
  const id = Number(formData.get("orderId"));
  if (!Number.isInteger(id) || id <= 0 || !(await replacePayToken(id))) {
    redirect(withFilter(`/${locale}/admin/orders?error=not-found`, statusFilter));
  }
  redirect(withFilter(`/${locale}/admin/orders?ok=paylink`, statusFilter));
}

/**
 * Append an internal note to an order.
 *
 * Staff-only in the strong sense: nothing customer-facing reads
 * `order_comments`, so this is the only way text gets in and there is no way
 * for it to reach the buyer. Append-only, so there is deliberately no edit or
 * delete action to go with it.
 */
export async function addCommentAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const statusFilter = String(formData.get("statusFilter") ?? "");
  const id = Number(formData.get("orderId"));
  const body = String(formData.get("body") ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) {
    redirect(withFilter(`/${locale}/admin/orders?error=bad-request`, statusFilter));
  }
  // An empty note is a mis-click, not something to record.
  if (!body) {
    redirect(withFilter(`/${locale}/admin/orders?ok=status`, statusFilter));
  }

  await addComment(id, body.slice(0, 4000));
  redirect(withFilter(`/${locale}/admin/orders?ok=comment`, statusFilter));
}

/**
 * The bank account customers pay into by transfer. Every field is optional;
 * card and Sheba numbers must pass their check digits, and one bad number
 * refuses the whole save so a half-updated account is never shown.
 */
export async function saveBankDetailsAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const read = (name: string) => String(formData.get(name) ?? "");
  const result = validateBankFields({
    nameEn: read("bankNameEn"),
    nameFa: read("bankNameFa"),
    holderEn: read("bankHolderEn"),
    holderFa: read("bankHolderFa"),
    card: read("bankCard"),
    sheba: read("bankSheba"),
    account: read("bankAccount"),
    noteEn: read("bankNoteEn"),
    noteFa: read("bankNoteFa"),
  });
  if (!result.ok) redirect(`/${locale}/admin/settings?bank=${result.problems.join(",")}#bank`);
  await saveBankFields(result.values);
  // No revalidation: bank details render only on dynamic pages (pay links and
  // a customer's own order page), never on a cached one.
  redirect(`/${locale}/admin/settings?bank=saved#bank`);
}
