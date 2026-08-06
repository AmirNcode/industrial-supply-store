"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { findUserIdByEmail, setPassword } from "@/db/userQueries";
import { hashPassword } from "@/lib/password";
import { assertAdminWrite, signInAdmin, signOutAdmin } from "@/lib/admin";
import { getFxRate, saveFxSettings } from "@/lib/fx";
import { envFxRate, isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";
import { safeLocale } from "@/lib/i18n";
import { assertTransition, isOrderStatus } from "@/lib/orders";

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
  // A failure returns to the form rather than to /admin, which would only
  // bounce straight back here and lose the error message on the way.
  redirect(ok ? `/${locale}/admin` : `/${locale}/admin/login?error=1`);
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
    redirect(withFilter(`/${locale}/admin?error=bad-request`, statusFilter));
  }

  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!row || !isOrderStatus(row.status)) {
    redirect(withFilter(`/${locale}/admin?error=not-found`, statusFilter));
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
      redirect(withFilter(`/${locale}/admin?error=tracking`, statusFilter));
    }
    const result = await sql`
      UPDATE orders
      SET status = 'shipped', courier = ${courier},
          tracking_number = ${tracking}, shipped_at = now()
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin?error=conflict`, statusFilter));
    }
  } else if (to === "preparing") {
    const result = await sql`
      UPDATE orders SET status = 'preparing', paid_at = now()
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin?error=conflict`, statusFilter));
    }
  } else if (to === "delivered") {
    const result = await sql`
      UPDATE orders SET status = 'delivered', delivered_at = now()
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin?error=conflict`, statusFilter));
    }
  } else if (to === "cancelled") {
    const result = await sql`
      UPDATE orders SET status = 'cancelled'
      WHERE id = ${id} AND status = ${row.status}
    `;
    if (result.count === 0) {
      redirect(withFilter(`/${locale}/admin?error=conflict`, statusFilter));
    }
  } else {
    // 'received' and 'invoiced' are not reachable here: nothing transitions to
    // 'received', and 'invoiced' belongs to issueInvoiceAction, which has the
    // prices and the payment link this action does not.
    redirect(withFilter(`/${locale}/admin?error=bad-request`, statusFilter));
  }

  revalidatePath("/", "layout");
  redirect(withFilter(`/${locale}/admin?ok=status`, statusFilter));
}

/** True for a string that parses as an absolute `http:`/`https:` URL. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Thrown inside `issueInvoiceAction`'s transaction when the order UPDATE
 * matches no row, and caught outside it once the transaction has settled.
 * `redirect()` throws its own control-flow error to unwind, so it cannot be
 * called from inside a `sql.begin()` callback: the transaction machinery
 * would catch that throw like any other query failure instead of letting it
 * propagate. A plain error here, redirected on from the `catch` below, keeps
 * the two unrelated kinds of "throw" from colliding.
 */
class OrderConflict extends Error {}

/**
 * Prices the order, assigns an invoice number, and freezes the exchange rate.
 *
 * All three happen in one transaction. An order carrying an invoice number but
 * no frozen rate would render a Persian invoice at whatever the rate happened
 * to be when someone opened it — a different amount owed on every viewing.
 */
export async function issueInvoiceAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const statusFilter = String(formData.get("statusFilter") ?? "");
  const id = Number(formData.get("orderId"));
  if (!Number.isInteger(id) || id <= 0) {
    redirect(withFilter(`/${locale}/admin?error=bad-request`, statusFilter));
  }

  const paymentUrl = String(formData.get("paymentUrl") ?? "").trim();
  if (!paymentUrl) redirect(withFilter(`/${locale}/admin?error=payment-link`, statusFilter));

  // The `type="url"` input is a client-side check only, trivially bypassed by
  // posting the form directly. This renders as plain text today, but a later
  // phase turns it into a link a customer clicks — at that point a
  // `javascript:` value stops being an inert string and becomes live code, so
  // the scheme is validated here, at write time, rather than trusted from the
  // browser.
  if (!isHttpUrl(paymentUrl)) {
    redirect(withFilter(`/${locale}/admin?error=payment-link`, statusFilter));
  }

  const [order] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!order || !isOrderStatus(order.status)) {
    redirect(withFilter(`/${locale}/admin?error=not-found`, statusFilter));
  }
  assertTransition(order.status, "invoiced");

  const itemRows = await sql<{ id: number }[]>`
    SELECT id FROM order_items WHERE order_id = ${id} ORDER BY id
  `;

  // Parse every price before writing anything, so a bad value on the last line
  // cannot leave the order half-priced.
  const priced: { id: number; cents: number }[] = [];
  for (const row of itemRows) {
    const raw = String(formData.get(`price_${row.id}`) ?? "").trim();
    const dollars = Number(raw);
    if (raw === "" || !Number.isFinite(dollars) || dollars < 0) {
      redirect(withFilter(`/${locale}/admin?error=prices`, statusFilter));
    }
    priced.push({ id: row.id, cents: Math.round(dollars * 100) });
  }

  const rate = await getFxRate();

  // The order UPDATE repeats `AND o.status = 'received'` rather than trusting
  // the SELECT above, for the same reason setOrderStatusAction's UPDATEs do:
  // the read can go stale before the write lands. Without the predicate, two
  // concurrent invoice submissions could both pass `assertTransition` and
  // both reach this UPDATE — each consuming a `nextval('invoice_seq')` — and
  // the second write would overwrite the first, leaving an invoice number
  // that may already be in a customer's inbox attached to no row. The line
  // item price updates run first, inside the same transaction, so if the
  // order UPDATE matches no row the whole transaction must not commit either —
  // hence the throw below, rather than a `count` check that lets the
  // function carry on and commit a half-applied invoice.
  try {
    await sql.begin(async (tx) => {
      for (const p of priced) {
        await tx`UPDATE order_items SET unit_price_cents = ${p.cents} WHERE id = ${p.id}`;
      }
      const result = await tx`
        UPDATE orders o
        SET status = 'invoiced',
            invoiced_at = now(),
            payment_url = ${paymentUrl},
            fx_rate_to_toman = ${rate},
            invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-' ||
                             lpad(nextval('invoice_seq')::text, 4, '0'),
            total_cents = (
              SELECT COALESCE(SUM(i.unit_price_cents * i.qty), 0)
              FROM order_items i WHERE i.order_id = o.id
            )
        WHERE o.id = ${id} AND o.status = 'received'
      `;
      if (result.count === 0) throw new OrderConflict();
    });
  } catch (err) {
    if (err instanceof OrderConflict) {
      redirect(withFilter(`/${locale}/admin?error=conflict`, statusFilter));
    }
    throw err;
  }

  revalidatePath("/", "layout");
  redirect(withFilter(`/${locale}/admin?ok=invoiced`, statusFilter));
}

/**
 * Generates a password, stores its hash, and hands the plaintext back exactly
 * once through the redirect so staff can read it out.
 *
 * There is no reset email in this version, so this is the only way back in for
 * a customer who has forgotten theirs. The plaintext is never stored and never
 * shown again — reloading the page loses it, which is the intended behaviour.
 */
export async function resetCustomerPasswordAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const email = String(formData.get("email") ?? "").trim();

  const userId = await findUserIdByEmail(email);
  if (!userId) redirect(`/${locale}/admin?error=no-account`);

  const generated = randomBytes(9).toString("base64url");
  await setPassword(userId, await hashPassword(generated));

  /*
   * Handed back in a short-lived cookie, not in the query string.
   *
   * A redirect puts the value in the Location header, the address bar, browser
   * history and the access log of every proxy in front of this app — request
   * query strings are logged by default nearly everywhere, and those logs
   * outlive the "shown exactly once" intent by whatever the retention is.
   * httpOnly is deliberately off: nothing reads it from script, but it is a
   * credential, and a 30-second life is the actual protection.
   */
  const jar = await cookies();
  jar.set("isupply_new_password", generated, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30,
  });
  redirect(`/${locale}/admin?ok=password`);
}
