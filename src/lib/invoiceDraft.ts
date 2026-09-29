/**
 * The admin's draft invoice lives in its URL.
 *
 * The prices typed in the order queue travel as `price_<line id>` query
 * parameters, so nothing is written until Finalize: an abandoned draft leaves
 * the order exactly as the customer placed it, and the draft page, "Change
 * prices" and a refused finalize all rebuild the same figures from the same
 * place. The finalize action parses prices with the same rule, so the draft
 * cannot show one number and issue another.
 */

/** `order_items.unit_price_cents` is a Postgres integer. */
const MAX_CENTS = 2_147_483_647;

/** "12.50" → 1250. Blank, negative, non-numeric or out of range → null. */
export function parsePriceDollars(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const dollars = Number(text);
  if (text === "" || !Number.isFinite(dollars) || dollars < 0) return null;
  const cents = Math.round(dollars * 100);
  return cents <= MAX_CENTS ? cents : null;
}

export function priceParamName(lineId: number): string {
  return `price_${lineId}`;
}

/** Cents back to what the queue's price input holds, exactly. */
export function priceParamValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Each line's price for the draft: the one in the query when it is there, the
 * line's own price when it is not. Null when a price is present but unusable —
 * the caller sends the admin back to the queue rather than guessing.
 */
export function draftLinePrices(
  query: Record<string, string | string[] | undefined>,
  lines: readonly { id: number; unitPriceCents: number }[],
): Map<number, number> | null {
  const prices = new Map<number, number>();
  for (const line of lines) {
    const raw = query[priceParamName(line.id)];
    if (raw === undefined) {
      prices.set(line.id, line.unitPriceCents);
      continue;
    }
    const cents = parsePriceDollars(raw);
    if (cents === null) return null;
    prices.set(line.id, cents);
  }
  return prices;
}

/** A query string carrying these prices, plus anything else the page needs. */
export function draftQuery(prices: ReadonlyMap<number, number>, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  for (const [id, cents] of prices) query.set(priceParamName(id), priceParamValue(cents));
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return query.toString();
}
