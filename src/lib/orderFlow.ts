import "server-only";
import { sql } from "@/db";
import type { AuditActor } from "@/db/audit";
import { sweepExpiredOrders, type SweepResult } from "@/db/expiryQueries";
import { issuePishFactor, type IssueOutcome } from "@/db/invoiceQueries";
import type { PlacedOrder } from "@/db/orderSubmissionQueries";
import { emailOrigin, sendEmail } from "./email";
import {
  orderExpiredEmail,
  paymentConfirmedEmail,
  pishFactorEmail,
  quoteReadyEmail,
  quoteRequestEmail,
  staffNewOrderEmail,
} from "./emailTemplates";
import { getFxRate, getFxRateSource } from "./fx";
import type { Locale } from "./i18n";
import { invoiceAmounts } from "./invoice";
import { formatAmount, formatPrice, type Currency } from "./money";
import { PISH_FACTOR_TTL_HOURS, QUOTE_TTL_DAYS } from "./orders";
import { getSiteContact } from "./siteContact";
import { isPlaceholderContact } from "./siteContactValues";
import { getVatRateBp } from "./vatSettings";

/**
 * What happens around an order's state changes: which emails go out, and the
 * one rule for whether a pish-factor may be issued at all. The state changes
 * themselves are in `db/` and never send anything — every function here runs
 * after its transaction has committed, so an email is never sent for a change
 * that rolled back, and a slow mail provider never holds a row lock.
 */

/**
 * The rate and VAT a pish-factor issued now would lock, or null when none may
 * be issued: a pish-factor fixes its rate for good, and the placeholder is
 * nobody's rate; nor is one sent with the stand-in seller details on it
 * (review L-6). Checkout then falls back to a request staff answer.
 */
export async function pishFactorTerms(): Promise<{ rate: number; vatRateBp: number } | null> {
  const [source, contact] = await Promise.all([getFxRateSource(), getSiteContact()]);
  if (source === "placeholder" || isPlaceholderContact(contact)) return null;
  const [rate, vatRateBp] = await Promise.all([getFxRate(), getVatRateBp()]);
  return { rate, vatRateBp };
}

type MailOrder = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  locale: Locale;
  currency: Currency;
  totalCents: number;
  fxRateToRial: number | null;
  vatRateBp: number | null;
  expiresAt: string | null;
  invoiceNumber: string | null;
  payToken: string;
};

async function mailOrder(id: number): Promise<MailOrder | null> {
  const [row] = await sql<(Omit<MailOrder, "locale" | "currency"> & { locale: string; currency: string })[]>`
    SELECT id, ref, company, contact_name AS "contactName", phone, email, locale, currency,
           total_cents AS "totalCents", fx_rate_to_rial AS "fxRateToRial",
           vat_rate_bp AS "vatRateBp", expires_at AS "expiresAt",
           invoice_number AS "invoiceNumber", pay_token AS "payToken"
    FROM orders WHERE id = ${id}
  `;
  if (!row) return null;
  return { ...row, locale: row.locale === "fa" ? "fa" : "en", currency: row.currency === "USD" ? "USD" : "IRR" };
}

/** Tehran time in the reader's calendar: the deadline as the customer's own clock shows it. */
export function formatDeadline(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

/** The amount due on an issued order, VAT included, in the order's currency. */
function totalDue(order: MailOrder): string {
  const rate = order.fxRateToRial ?? 1;
  const { total } = invoiceAmounts(order.totalCents, order.vatRateBp ?? 0, order.currency, rate);
  return formatAmount(total, order.currency, order.locale);
}

async function links(order: MailOrder) {
  const origin = await emailOrigin();
  return {
    origin,
    payUrl: `${origin}/${order.locale}/pay/${order.payToken}`,
    documentUrl: `${origin}/${order.locale}/invoice/${order.ref}?key=${order.payToken}`,
  };
}

async function staffAddress(): Promise<string | null> {
  const configured = process.env.STAFF_NOTIFY_EMAIL?.trim();
  if (configured) return configured;
  const contact = await getSiteContact();
  return isPlaceholderContact(contact) ? null : contact.email;
}

async function sendPishFactor(order: MailOrder): Promise<void> {
  if (!order.email || !order.expiresAt) return;
  const { payUrl, documentUrl } = await links(order);
  await sendEmail({
    kind: "pish-factor",
    to: order.email,
    orderId: order.id,
    ...pishFactorEmail({
      locale: order.locale,
      ref: order.ref,
      company: order.company,
      total: totalDue(order),
      payUrl,
      documentUrl,
      deadline: formatDeadline(order.expiresAt, order.locale),
      hours: PISH_FACTOR_TTL_HOURS,
    }),
  });
}

/**
 * After checkout commits: the customer gets the pish-factor or the "request
 * received" note for each order written, and staff are told about each —
 * until now nothing alerted them, and with a five-day clock on a request, a
 * missed one would quietly release its stock.
 */
export async function notifyOrdersPlaced(placed: readonly PlacedOrder[]): Promise<void> {
  const staff = await staffAddress();
  for (const { id, issued } of placed) {
    const order = await mailOrder(id);
    if (!order) continue;
    const { origin, payUrl } = await links(order);
    if (issued) await sendPishFactor(order);
    else if (order.email) {
      await sendEmail({
        kind: "quote-request",
        to: order.email,
        orderId: order.id,
        ...quoteRequestEmail({
          locale: order.locale,
          ref: order.ref,
          company: order.company,
          payUrl,
          days: QUOTE_TTL_DAYS,
        }),
      });
    }
    if (staff) {
      await sendEmail({
        kind: issued ? "staff-new-order" : "staff-quote-request",
        to: staff,
        orderId: order.id,
        ...staffNewOrderEmail({
          ref: order.ref,
          company: order.company,
          contactName: order.contactName,
          phone: order.phone,
          kind: issued ? "pish-factor" : "quote-request",
          // Staff read rial; the live rate is right for an order not yet locked.
          total: formatPrice(order.totalCents, "IRR", "fa", order.fxRateToRial ?? (await getFxRate())),
          adminUrl: `${origin}/fa/admin/orders`,
          quoteDays: QUOTE_TTL_DAYS,
        }),
      });
    }
  }
}

/** After staff send a quote: tell the customer it is waiting for their yes. */
export async function notifyQuoteSent(orderId: number): Promise<void> {
  const order = await mailOrder(orderId);
  if (!order?.email || !order.expiresAt) return;
  const { payUrl } = await links(order);
  await sendEmail({
    kind: "quote-ready",
    to: order.email,
    orderId,
    ...quoteReadyEmail({
      locale: order.locale,
      ref: order.ref,
      company: order.company,
      total: formatPrice(order.totalCents, order.currency, order.locale, await getFxRate()),
      payUrl,
      deadline: formatDeadline(order.expiresAt, order.locale),
    }),
  });
}

/** After the admin confirms payment: the numbered invoice exists now. */
export async function notifyPaymentConfirmed(orderId: number): Promise<void> {
  const order = await mailOrder(orderId);
  if (!order?.email || !order.invoiceNumber) return;
  const { payUrl, documentUrl } = await links(order);
  await sendEmail({
    kind: "payment-confirmed",
    to: order.email,
    orderId,
    ...paymentConfirmedEmail({
      locale: order.locale,
      ref: order.ref,
      company: order.company,
      total: totalDue(order),
      payUrl,
      documentUrl,
      invoiceNumber: order.invoiceNumber,
    }),
  });
}

/**
 * A quote accepted — by the customer, or by staff or a rep on a customer's
 * word. Issues the pish-factor at the rate and VAT of this moment and emails
 * it. "conflict" covers a quote that lapsed or was answered twice.
 */
export async function acceptQuote(orderId: number, actor: AuditActor): Promise<IssueOutcome | "no-rate"> {
  // A lapsed quote must not be accepted in the gap before someone looks.
  await runExpirySweep({ force: true });
  const terms = await pishFactorTerms();
  if (!terms) return "no-rate";
  const outcome = await issuePishFactor(orderId, { ...terms, from: "quoted", actor });
  if (outcome === "issued") {
    const order = await mailOrder(orderId);
    if (order) await sendPishFactor(order);
  }
  return outcome;
}

/**
 * The deadline sweep plus its emails. Pages call it bare (at most one real
 * sweep a minute per server instance); checkout and accept force it so the
 * stock and status they act on are current.
 */
export async function runExpirySweep(options: { force?: boolean } = {}): Promise<SweepResult> {
  const result = await sweepExpiredOrders(options);
  for (const expired of result.cancelled) {
    const order = await mailOrder(expired.id);
    if (!order?.email) continue;
    const { origin, payUrl } = await links(order);
    await sendEmail({
      kind: "order-expired",
      to: order.email,
      orderId: order.id,
      ...orderExpiredEmail({
        locale: order.locale,
        ref: order.ref,
        company: order.company,
        payUrl,
        was: expired.was,
        shopUrl: `${origin}/${order.locale}`,
      }),
    });
  }
  return result;
}
