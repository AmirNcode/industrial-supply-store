import "server-only";
import { sql } from "./index";

/**
 * One order's pay token, read only when staff ask for it.
 *
 * The admin queue used to put every open order's link into its page payload,
 * so one copied page — or one saved HTML file, or a demo visitor — carried the
 * key to every order in it: upload a "receipt" and the order moves to payment
 * review. Reading one token per click keeps the credential out of any page.
 */
export async function getPayLinkParts(
  orderId: number,
): Promise<{ token: string; locale: "en" | "fa" } | null> {
  const [row] = await sql<{ token: string; locale: string }[]>`
    SELECT pay_token AS token, locale FROM orders WHERE id = ${orderId}
  `;
  if (!row) return null;
  return { token: row.token, locale: row.locale === "fa" ? "fa" : "en" };
}

/**
 * Kills a leaked link: the order gets a fresh token from the same expression
 * as the column default, and the old one opens nothing from now on. Receipts
 * already sent stay on the order.
 */
export async function replacePayToken(orderId: number): Promise<boolean> {
  const rows = await sql`
    UPDATE orders
    SET pay_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    WHERE id = ${orderId}
    RETURNING id
  `;
  return rows.length === 1;
}
