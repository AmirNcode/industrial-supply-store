import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { exceedsOrderLimit } from "@/lib/invoice";
import { persianYearMonth } from "@/lib/persianCalendar";
import { recordAudit, type AuditActor } from "./audit";
import { PISH_FACTOR_TTL_HOURS, QUOTE_TTL_DAYS } from "@/lib/orders";

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
 * Thrown inside a transaction below when a write matches fewer rows than it
 * must, and caught outside it once the transaction has rolled back. Callers
 * get an outcome and redirect: `redirect()` throws its own control-flow
 * error, which the transaction machinery would catch like any query failure,
 * so it cannot be called from inside the callback.
 */
class InvoiceConflict extends Error {}

/** Thrown inside the same transaction when a line would go out at 0. */
class InvoiceUnpriced extends Error {}

/** Thrown when the total would not fit `orders.total_cents` (review M-9). */
class InvoiceTooLarge extends Error {}

export type IssueOutcome = "issued" | "conflict" | "unpriced" | "too-large";

/**
 * No document goes to a customer with a line at 0: a product with no list
 * price is stored at 0 ("call for price"), so a zero line is one nobody
 * priced, and sending it gives the goods away. Checked inside the transaction
 * that sends, after any prices in it are applied, so no caller can skip it.
 */
async function assertPricedAndBounded(tx: Tx, orderId: number): Promise<void> {
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
}

function outcomeOf(err: unknown): IssueOutcome {
  if (err instanceof InvoiceConflict) return "conflict";
  if (err instanceof InvoiceUnpriced) return "unpriced";
  if (err instanceof InvoiceTooLarge) return "too-large";
  throw err;
}

/**
 * Staff answer a request: prices are set and the order moves
 * `received → quoted`, where it waits for the customer to accept. Nothing is
 * locked yet — a quote is in dollars, and the rial amount is fixed only when
 * it is accepted (`issuePishFactor`), so the exchange rate is not carried for
 * the days a customer takes to decide. The quote stands for `QUOTE_TTL_DAYS`.
 *
 * `prices` is the admin's; a rep quotes at the prices already on the order.
 * The UPDATE repeats `AND o.status = 'received'` rather than trusting the
 * caller's earlier read, which can go stale before the write lands; the price
 * updates run first inside the same transaction, so a lost race rolls them
 * back too.
 */
export async function sendQuote(
  orderId: number,
  quote: { prices?: readonly OrderItemPrice[]; actor?: AuditActor },
): Promise<IssueOutcome> {
  try {
    await sql.begin(async (tx) => {
      if (quote.prices) {
        const updated = await updateOrderItemPrices(tx, orderId, quote.prices);
        if (updated !== quote.prices.length) throw new InvoiceConflict();
      }
      await assertPricedAndBounded(tx, orderId);
      const result = await tx`
        UPDATE orders o
        SET status = 'quoted',
            quoted_at = now(),
            expires_at = now() + make_interval(days => ${QUOTE_TTL_DAYS}),
            total_cents = (
              SELECT COALESCE(SUM(i.unit_price_cents::bigint * i.qty), 0)
              FROM order_items i WHERE i.order_id = o.id
            )
        WHERE o.id = ${orderId} AND o.status = 'received'
        RETURNING o.total_cents AS "totalCents"
      `;
      if (result.count === 0) throw new InvoiceConflict();
      await recordAudit(tx, {
        actor: quote.actor ?? { kind: "admin" },
        action: "quote.sent",
        subject: { kind: "order", id: orderId },
        detail: { totalCents: result[0].totalCents, pricesChanged: quote.prices?.length ?? 0 },
      });
    });
    return "issued";
  } catch (err) {
    return outcomeOf(err);
  }
}

/**
 * The pish-factor: the order becomes payable, and the exchange rate and VAT
 * rate lock for the `PISH_FACTOR_TTL_HOURS` it stays payable.
 *
 * Reached by the customer accepting a quote, or by staff accepting for them
 * (a "yes" on the phone). Checkout issues its own in the statement that
 * creates the order (`insertOrder`); the rules are the same.
 *
 * An order with a locked rate but no deadline, or the reverse, would be
 * payable forever or at whatever the rate happens to be on the day someone
 * opens it — so all of it is one UPDATE. There is no invoice number here: that
 * is assigned when payment is confirmed (`confirmPayment`), so an order that
 * is never paid never uses one.
 */
export async function issuePishFactor(
  orderId: number,
  locked: { rate: number; vatRateBp: number; from: "quoted" | "received"; actor: AuditActor },
): Promise<IssueOutcome> {
  try {
    await sql.begin(async (tx) => {
      await assertPricedAndBounded(tx, orderId);
      const result = await tx`
        UPDATE orders o
        SET status = 'invoiced',
            invoiced_at = now(),
            fx_rate_to_rial = ${locked.rate},
            vat_rate_bp = ${locked.vatRateBp},
            expires_at = now() + make_interval(hours => ${PISH_FACTOR_TTL_HOURS}),
            total_cents = (
              SELECT COALESCE(SUM(i.unit_price_cents::bigint * i.qty), 0)
              FROM order_items i WHERE i.order_id = o.id
            )
        WHERE o.id = ${orderId} AND o.status = ${locked.from}
        RETURNING o.total_cents AS "totalCents"
      `;
      if (result.count === 0) throw new InvoiceConflict();
      await recordAudit(tx, {
        actor: locked.actor,
        action: "pish-factor.issued",
        subject: { kind: "order", id: orderId },
        detail: {
          from: locked.from,
          totalCents: result[0].totalCents,
          rate: locked.rate,
          vatRateBp: locked.vatRateBp,
        },
      });
    });
    return "issued";
  } catch (err) {
    return outcomeOf(err);
  }
}

/**
 * The official invoice number, as a SQL fragment for the statement that
 * records payment.
 *
 * At least four digits, never truncated: lpad cuts a longer string to the
 * width, so a fixed width of 4 turned invoice 10,000 into 1000 and collided
 * from there on (review H-3). The year is the Persian year on Tehran time,
 * which is how Iranian books are kept (L-5); Postgres has no Persian
 * calendar, so Node supplies it and the sequence stays one running count.
 */
export function nextInvoiceNumber(tx: Tx) {
  return tx`(
    SELECT 'INV-' || ${String(persianYearMonth(new Date()).year)} || '-' ||
           lpad(s.n::text, greatest(4, length(s.n::text)), '0')
    FROM (SELECT nextval('invoice_seq') AS n) s
  )`;
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
  postalCode: string;
  buyerNationalId: string;
  buyerEconomicCode: string;
};

export type InvoiceOrder = InvoiceParty & {
  /** Null while the document is a pish-factor; assigned when payment is confirmed. */
  invoiceNumber: string | null;
  /** Until when the pish-factor is payable; null once a receipt arrived or it was paid. */
  expiresAt: string | null;
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
  backorder: boolean;
};

const PARTY_COLS = sql`id, ref, company, contact_name AS "contactName", email, phone,
  po_number AS "poNumber", address, city, country, total_cents AS "totalCents", status,
  pay_token AS "payToken", postal_code AS "postalCode",
  buyer_national_id AS "buyerNationalId", buyer_economic_code AS "buyerEconomicCode"`;

async function listInvoiceItems(orderId: number): Promise<InvoiceItem[]> {
  return sql<InvoiceItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName",
           qty, unit_price_cents AS "unitPriceCents", backorder
    FROM order_items WHERE order_id = ${orderId} ORDER BY id
  `;
}

/**
 * A document exists once the pish-factor is issued.
 *
 * `invoiced_at IS NOT NULL` is the whole access rule for "is there a document
 * here": an order still being priced has nothing to show, and rendering an
 * empty one would invite someone to send it. `fx_rate_to_rial IS NOT NULL`
 * pairs with it — the two are written in the same statement, so a row with
 * one and not the other means something has gone wrong and we would rather
 * 404 than print a total at the wrong rate. Whether it prints as a
 * pish-factor or as the official invoice is `invoiceNumber`.
 */
export async function getInvoiceByRef(
  ref: string,
): Promise<{ order: InvoiceOrder; items: InvoiceItem[] } | null> {
  const rows = await sql<InvoiceOrder[]>`
    SELECT ${PARTY_COLS}, invoice_number AS "invoiceNumber",
           fx_rate_to_rial AS "fxRateToRial", vat_rate_bp AS "vatRateBp",
           invoiced_at AS "invoicedAt", user_id AS "userId", expires_at AS "expiresAt"
    FROM orders
    WHERE ref = ${ref}
      AND invoiced_at IS NOT NULL
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
