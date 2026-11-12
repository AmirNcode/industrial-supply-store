import "server-only";
import { sql } from "./index";

export type MailOrderRow = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  locale: string;
  currency: string;
  totalCents: number;
  fxRateToRial: number | null;
  vatRateBp: number | null;
  expiresAt: string | null;
  invoiceNumber: string | null;
  payToken: string;
};

/**
 * What an order's emails need, with the recipient resolved here, once: the
 * order's own email, else the account's. A rep's order for an unassigned
 * customer is stored with no email on purpose (the rep must not be able to
 * read the customer's address off the order), so the customer's mail still
 * reaches them through the account, on the server only.
 */
export async function getOrderForMail(id: number, db: typeof sql = sql): Promise<MailOrderRow | null> {
  const [row] = await db<MailOrderRow[]>`
    SELECT o.id, o.ref, o.company, o.contact_name AS "contactName", o.phone,
           COALESCE(NULLIF(o.email, ''), u.email, '') AS email, o.locale, o.currency,
           o.total_cents AS "totalCents", o.fx_rate_to_rial AS "fxRateToRial",
           o.vat_rate_bp AS "vatRateBp", o.expires_at AS "expiresAt",
           o.invoice_number AS "invoiceNumber", o.pay_token AS "payToken"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = ${id}
  `;
  return row ?? null;
}
