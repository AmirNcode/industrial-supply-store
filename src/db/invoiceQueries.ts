import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { exceedsOrderLimit } from "@/lib/invoice";
import { recordAudit, type AuditActor } from "./audit";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export type OrderItemPrice = { id: number; cents: number };

/** Apply all prices from one submitted invoice form in one guarded update. */
export async function updateOrderItemPrices(
  tx: Tx,
  orderId: number,
  prices: readonly OrderItemPrice[],
): Promise<number> {
  if (prices.length === 0) return 0;
  const result = await tx`
    UPDATE order_items i
    SET unit_price_cents = submitted.cents
    FROM unnest(
      ${prices.map((item) => item.id)}::int[],
      ${prices.map((item) => item.cents)}::int[]
    ) AS submitted(id, cents)
    WHERE i.id = submitted.id AND i.order_id = ${orderId}
  `;
  return result.count;
}

/**
 * Thrown inside `issueInvoice`'s transaction when a write matches fewer rows
 * than it must, and caught outside it once the transaction has rolled back.
 * Callers get `false` and redirect: `redirect()` throws its own control-flow
 * error, which the transaction machinery would catch like any query failure,
 * so it cannot be called from inside the callback.
 */
class InvoiceConflict extends Error {}

/** Thrown inside the same transaction when a line would be invoiced at 0. */
class InvoiceUnpriced extends Error {}

/** Thrown when the total would not fit `orders.total_cents` (review M-9). */
class InvoiceTooLarge extends Error {}

export type IssueOutcome = "issued" | "conflict" | "unpriced" | "too-large";

/**
 * Prices the order, assigns an invoice number, and locks the exchange rate
 * and the VAT rate — in one transaction, shared by the admin and the rep.
 *
 * An order carrying an invoice number but no frozen rate would render a
 * Persian invoice at whatever the rate happened to be when someone opened it:
 * a different amount owed on every viewing. VAT is locked for the same reason.
 *
 * The order UPDATE repeats `AND o.status = 'received'` rather than trusting
 * the caller's earlier read, which can go stale before the write lands.
 * Without it, two concurrent submissions could each consume a
 * `nextval('invoice_seq')` and the second would overwrite the first, leaving
 * an invoice number that may already be in a customer's inbox attached to no
 * row. The price updates run first inside the same transaction, so a lost
 * race rolls them back too rather than committing a half-applied invoice.
 *
 * `prices` is the admin's; a rep invoices at the prices already on the order.
 * Returns "conflict" when the order was no longer waiting to be invoiced, and
 * "unpriced" when any line would be invoiced at 0: 384 live products carry
 * price 0 ("call for price"), and an invoice at their stored price gives the
 * goods away. Checked after the admin's prices are applied, inside the same
 * transaction, so no caller can skip it.
 */
export async function issueInvoice(
  orderId: number,
  locked: {
    rate: number;
    vatRateBp: number;
    prices?: readonly OrderItemPrice[];
    /** Who issued it, for the audit trail; the admin unless a rep's id is given. */
    actor?: AuditActor;
  },
): Promise<IssueOutcome> {
  try {
    await sql.begin(async (tx) => {
      if (locked.prices) {
        const updated = await updateOrderItemPrices(tx, orderId, locked.prices);
        if (updated !== locked.prices.length) throw new InvoiceConflict();
      }
      const [unpriced] = await tx`
        SELECT 1 FROM order_items WHERE order_id = ${orderId} AND unit_price_cents <= 0 LIMIT 1
      `;
      if (unpriced) throw new InvoiceUnpriced();
      // Multiplied as bigint: int * int overflows before SUM can widen it.
      const [{ total }] = await tx<{ total: string }[]>`
        SELECT COALESCE(SUM(unit_price_cents::bigint * qty), 0)::text AS total
        FROM order_items WHERE order_id = ${orderId}
      `;
      if (exceedsOrderLimit(Number(total))) throw new InvoiceTooLarge();
      const result = await tx`
        UPDATE orders o
        SET status = 'invoiced',
            invoiced_at = now(),
            fx_rate_to_rial = ${locked.rate},
            vat_rate_bp = ${locked.vatRateBp},
            -- At least four digits, never truncated: lpad cuts a longer
            -- string to the width, so a fixed width of 4 turned invoice
            -- 10,000 into 1000 and collided from there on (review H-3).
            invoice_number = (
              -- The year in Tehran, where the invoice is dated: in UTC an
              -- invoice issued 00:00–03:30 on 1 January carried last year (L-5).
              SELECT 'INV-' || to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY') || '-' ||
                     lpad(s.n::text, greatest(4, length(s.n::text)), '0')
              FROM (SELECT nextval('invoice_seq') AS n) s
            ),
            total_cents = (
              SELECT COALESCE(SUM(i.unit_price_cents::bigint * i.qty), 0)
              FROM order_items i WHERE i.order_id = o.id
            )
        WHERE o.id = ${orderId} AND o.status = 'received'
        RETURNING o.invoice_number AS "invoiceNumber", o.total_cents AS "totalCents"
      `;
      if (result.count === 0) throw new InvoiceConflict();
      await recordAudit(tx, {
        actor: locked.actor ?? { kind: "admin" },
        action: "invoice.issued",
        subject: { kind: "order", id: orderId },
        detail: {
          invoiceNumber: result[0].invoiceNumber,
          totalCents: result[0].totalCents,
          rate: locked.rate,
          vatRateBp: locked.vatRateBp,
          pricesChanged: locked.prices?.length ?? 0,
        },
      });
    });
    return "issued";
  } catch (err) {
    if (err instanceof InvoiceConflict) return "conflict";
    if (err instanceof InvoiceUnpriced) return "unpriced";
    if (err instanceof InvoiceTooLarge) return "too-large";
    throw err;
  }
}

/** Who the invoice is addressed to — the same fields on a draft and an issued one. */
export type InvoiceParty = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  address: string;
  city: string;
  country: string;
  totalCents: number;
  status: string;
  /** The pay link's key: the invoice points customers there to upload a receipt. */
  payToken: string;
};

export type InvoiceOrder = InvoiceParty & {
  invoiceNumber: string;
  /** Rial per USD, frozen when the invoice was issued. Never null here. */
  fxRateToRial: number;
  /** Locked with the rate; null on an invoice issued before VAT existed. */
  vatRateBp: number | null;
  invoicedAt: string;
  /** Null for a guest order — nobody but staff may read that invoice. */
  userId: string | null;
};

export type InvoiceItem = {
  id: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
};

const PARTY_COLS = sql`id, ref, company, contact_name AS "contactName", email, phone,
  po_number AS "poNumber", address, city, country, total_cents AS "totalCents", status,
  pay_token AS "payToken"`;

async function listInvoiceItems(orderId: number): Promise<InvoiceItem[]> {
  return sql<InvoiceItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName",
           qty, unit_price_cents AS "unitPriceCents"
    FROM order_items WHERE order_id = ${orderId} ORDER BY id
  `;
}

/**
 * An invoice exists only once a number has been assigned.
 *
 * The `invoice_number IS NOT NULL` predicate is the whole access rule for
 * "is there an invoice here": an order still being priced has no document to
 * show, and rendering an empty one would invite someone to send it. The
 * `fx_rate_to_rial IS NOT NULL` predicate pairs with it — the two are written
 * in the same statement, so a row with one and not the other means something
 * has gone wrong and we would rather 404 than print a total at the wrong rate.
 */
export async function getInvoiceByRef(
  ref: string,
): Promise<{ order: InvoiceOrder; items: InvoiceItem[] } | null> {
  const rows = await sql<InvoiceOrder[]>`
    SELECT ${PARTY_COLS}, invoice_number AS "invoiceNumber",
           fx_rate_to_rial AS "fxRateToRial", vat_rate_bp AS "vatRateBp",
           invoiced_at AS "invoicedAt", user_id AS "userId"
    FROM orders
    WHERE ref = ${ref}
      AND invoice_number IS NOT NULL
      AND fx_rate_to_rial IS NOT NULL
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;
  return { order, items: await listInvoiceItems(order.id) };
}

/**
 * The order behind a draft invoice, in whatever status it is in — the draft
 * pages send anything past `received` on to the real invoice. Access is the
 * caller's: the admin panel's gate, or a rep's visibility check first.
 */
export async function getInvoiceDraft(
  ref: string,
): Promise<{ order: InvoiceParty; items: InvoiceItem[] } | null> {
  const [order] = await sql<InvoiceParty[]>`
    SELECT ${PARTY_COLS} FROM orders WHERE ref = ${ref} LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listInvoiceItems(order.id) };
}
