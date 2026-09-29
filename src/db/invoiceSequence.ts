import type { Sql } from "postgres";

/**
 * Moves `invoice_seq` past every invoice number already issued — never
 * backwards.
 *
 * `db:extensions` runs this after a schema push, which can recreate the
 * sequence at 1. It used to set the sequence to the largest issued number
 * read with `split_part(…)::int`, which had two faults (review finding H-3):
 * a number like `INV-2026-A7` threw, and when numbers had been truncated to
 * four digits the "largest" was at most 9,999, so the repair wound a sequence
 * that had passed 10,000 back into numbers already issued. Now it takes the
 * greater of the sequence's own position and the numeric maximum of every
 * well-formed number, so running it can only ever move forward.
 *
 * Takes the client as a parameter: scripts use their own, not the app's.
 */
export async function realignInvoiceSequence(sql: Sql): Promise<number> {
  const [{ next }] = await sql<{ next: string }[]>`
    SELECT GREATEST(
      (SELECT COALESCE(max((regexp_match(invoice_number, '^INV-[0-9]{4}-([0-9]+)$'))[1]::bigint), 0)
       FROM orders WHERE invoice_number IS NOT NULL),
      (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM invoice_seq)
    )::text AS next
  `;
  const value = Number(next);
  if (value > 0) await sql`SELECT setval('invoice_seq', ${value}, true)`;
  else await sql`SELECT setval('invoice_seq', 1, false)`;
  return value;
}
