import "server-only";
import { sql } from "./index";

/** An empty cart nobody has touched for this long is deleted. */
export const EMPTY_CART_DAYS = 30;
/** How long a sent email's full text is kept in the log. */
export const EMAIL_LOG_DAYS = 365;

/**
 * The daily tidy-up (review R-21). Every visitor who adds something and then
 * empties their cart, or checks out, leaves a cart row behind for good, and
 * every email's full text is stored forever, against a 500 MB database.
 *
 * Only what nobody can miss goes: a cart with nothing in it (a returning
 * visitor's cookie simply gets a new one — `ensureCart` already handles a
 * cookie that outlived its row), and email text more than a year old. Carts
 * that still hold items and the audit log are left alone.
 *
 * Bounded per run so a first run over a long backlog cannot hold the job past
 * its time limit; the rest goes the next day.
 */
export async function pruneStaleRows(): Promise<{ carts: number; emails: number }> {
  const carts = await sql`
    DELETE FROM carts c
    WHERE c.id IN (
      SELECT id FROM carts
      WHERE updated_at < now() - make_interval(days => ${EMPTY_CART_DAYS})
        AND NOT EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = carts.id)
      LIMIT 5000
    )
  `;
  const emails = await sql`
    DELETE FROM email_log e
    WHERE e.id IN (
      SELECT id FROM email_log
      WHERE created_at < now() - make_interval(days => ${EMAIL_LOG_DAYS})
      LIMIT 5000
    )
  `;
  return { carts: carts.count, emails: emails.count };
}
