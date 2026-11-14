import "server-only";
import { cache } from "react";
import { sql } from "@/db";

/** The market-rate history: 30 readings of JSON, read only by the rate job and its admin panel. */
const LARGE_KEY = "fx_market_state";

/**
 * Every small setting in one read per request.
 *
 * Prices, the masthead's contact line, VAT and the bank details each used to
 * read their own few keys, so one catalog page made three trips to the
 * database for a dozen short rows of the same table (review R-24). They now
 * share this one. The one large value is left out: it would ride along on
 * every page view for a job that runs once a day.
 *
 * React's `cache` is per request, so a saved setting shows on the next render.
 */
export const getSmallSettings = cache(async (): Promise<ReadonlyMap<string, string>> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings WHERE key <> ${LARGE_KEY}
  `;
  return new Map(rows.map((row) => [row.key, row.value]));
});
