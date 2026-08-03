"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { assertAdminWrite, signInAdmin, signOutAdmin } from "@/lib/admin";
import { saveFxSettings } from "@/lib/fx";
import { envFxRate, isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";
import { isLocale, type Locale } from "@/lib/i18n";
import { assertTransition, isOrderStatus } from "@/lib/orders";

/**
 * Every action in this file redirects to `/${locale}/admin`, so the posted
 * value reaches `redirect()` unchanged. A `locale` of `/evil.com` would make
 * that `//evil.com/admin` — a protocol-relative URL, and an open redirect.
 * Anything unrecognised falls back to English.
 */
function safeLocale(formData: FormData): Locale {
  const raw = String(formData.get("locale") ?? "");
  return isLocale(raw) ? raw : "en";
}

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
  const ok = await signInAdmin(String(formData.get("password") ?? ""));
  redirect(`/${locale}/admin${ok ? "" : "?error=1"}`);
}

export async function logoutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await signOutAdmin();
  redirect(`/${locale}/admin`);
}

export async function saveFxAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const rawMode = String(formData.get("mode") ?? "auto");
  const mode = isFxMode(rawMode) ? rawMode : "auto";

  let manualRate: number | null = null;
  if (mode === "manual") {
    const parsed = parseRate(String(formData.get("rate") ?? ""));
    if (parsed === null) redirect(`/${locale}/admin?fx=invalid`);
    if (!isPlausibleRate(parsed, envFxRate())) {
      redirect(`/${locale}/admin?fx=range`);
    }
    manualRate = parsed;
  }

  await saveFxSettings(mode, manualRate);
  // The catalog is statically rendered with revalidate = 3600, so without this
  // a rate change would take up to an hour to reach the pages that show it.
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?fx=saved`);
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const id = Number(formData.get("orderId"));
  const to = String(formData.get("status") ?? "");
  if (!Number.isInteger(id) || id <= 0 || !isOrderStatus(to)) {
    redirect(`/${locale}/admin?error=bad-request`);
  }

  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!row || !isOrderStatus(row.status)) redirect(`/${locale}/admin?error=not-found`);

  // Throws rather than redirecting: reaching here with an illegal pair means a
  // hand-crafted post or a bug, not a mistake a form can make.
  assertTransition(row.status, to);

  // One explicit statement per destination. A single query with an
  // interpolated column name would be shorter and much harder to read at the
  // one place in this codebase that decides whether goods have shipped.
  if (to === "shipped") {
    const courier = String(formData.get("courier") ?? "").trim();
    const tracking = String(formData.get("trackingNumber") ?? "").trim();
    // The whole point of this state is showing the customer a tracking number.
    if (!courier || !tracking) redirect(`/${locale}/admin?error=tracking`);
    await sql`
      UPDATE orders
      SET status = 'shipped', courier = ${courier},
          tracking_number = ${tracking}, shipped_at = now()
      WHERE id = ${id}
    `;
  } else if (to === "preparing") {
    await sql`UPDATE orders SET status = 'preparing', paid_at = now() WHERE id = ${id}`;
  } else if (to === "delivered") {
    await sql`UPDATE orders SET status = 'delivered', delivered_at = now() WHERE id = ${id}`;
  } else if (to === "cancelled") {
    await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${id}`;
  } else {
    // 'received' and 'invoiced' are not reachable here: nothing transitions to
    // 'received', and 'invoiced' belongs to issueInvoiceAction, which has the
    // prices and the payment link this action does not.
    redirect(`/${locale}/admin?error=bad-request`);
  }

  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?ok=status`);
}
