import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "@/db";
import { KEY_MARKET_RATE, KEY_MARKET_STATE } from "./fx";
import {
  anchorFor,
  combinePrices,
  marketRate,
  parseMarketState,
  parseNobitex,
  parseWallex,
  serializeMarketState,
  tehranDate,
  upsertReading,
  type Reading,
  type RefusalReason,
} from "./fxMarket";

type Tx = TransactionSql<Record<string, never>>;

/**
 * Both are public market-data endpoints that need no key. Nobitex documents
 * its limit as 20 requests a minute; this runs once a day.
 */
const NOBITEX_URL = "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls";
/** The recent-trades feed: ~9 KB, where the all-markets list is ~450 KB. */
const WALLEX_URL = "https://api.wallex.ir/v1/trades?symbol=USDTTMN";

/** Nobitex asks automated clients to identify themselves in this shape. */
const USER_AGENT = "TraderBot/temex-fx-rate-1.0";

/**
 * Serialises two runs landing together — the evening job and someone pressing
 * "Update now". Without it both read the same history and the second write
 * silently discards the first's reading.
 */
const MARKET_LOCK = 1842150201;

export type RefreshResult =
  | { ok: true; rate: number; reading: Reading }
  | { ok: false; reason: RefusalReason; nobitex: number | null; wallex: number | null };

async function fetchPrice(
  name: string,
  url: string,
  parse: (body: unknown) => number | null,
): Promise<number | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      // Well inside the route's 60s ceiling even with both exchanges slow.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const price = parse(await response.json());
    if (price === null) throw new Error("no usable price in the response");
    return price;
  } catch (error) {
    // One exchange failing is survivable, so this is a log line for the
    // deployment's logs, not an exception.
    console.error(`[fx] ${name}: ${(error as Error).message}`);
    return null;
  }
}

async function put(tx: Tx, key: string, value: string): Promise<void> {
  await tx`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `;
}

/**
 * Take today's reading and, if it is believable, reprice.
 *
 * A refused reading changes nothing a customer sees: the rate stays where the
 * last good reading put it, and the attempt is recorded so the admin panel can
 * say why. No page cache is purged, because every page that shows a price is
 * rendered per request and reads the rate as it renders — the whole-site purge
 * `saveFxAction` does would be pure cost here, once a day, forever.
 */
export async function refreshMarketRate(now = new Date()): Promise<RefreshResult> {
  // Fetched before the transaction, so no database connection is held open
  // while two foreign servers take their time.
  const [nobitex, wallex] = await Promise.all([
    fetchPrice("nobitex", NOBITEX_URL, parseNobitex),
    fetchPrice("wallex", WALLEX_URL, parseWallex),
  ]);
  const today = tehranDate(now);

  return sql.begin(async (tx): Promise<RefreshResult> => {
    await tx`SELECT pg_advisory_xact_lock(${MARKET_LOCK})`;
    const [row] = await tx<{ value: string }[]>`
      SELECT value FROM app_settings WHERE key = ${KEY_MARKET_STATE}
    `;
    const state = parseMarketState(row?.value);
    const combined = combinePrices({ nobitex, wallex }, anchorFor(state.readings, today));
    const attempt = {
      at: now.toISOString(),
      ok: combined.ok,
      reason: combined.ok ? null : combined.reason,
      nobitex,
      wallex,
    };

    if (!combined.ok) {
      console.error(`[fx] reading refused: ${combined.reason}`, { nobitex, wallex });
      await put(tx, KEY_MARKET_STATE, serializeMarketState({ ...state, lastAttempt: attempt }));
      return { ok: false, reason: combined.reason, nobitex, wallex };
    }

    const reading: Reading = { date: today, rial: combined.rial, nobitex, wallex };
    const readings = upsertReading(state.readings, reading);
    // Never null: `readings` holds at least the one just added.
    const rate = marketRate(readings) as number;
    await put(tx, KEY_MARKET_RATE, String(rate));
    await put(
      tx,
      KEY_MARKET_STATE,
      serializeMarketState({ readings, lastAttempt: attempt, updatedAt: attempt.at }),
    );
    return { ok: true, rate, reading };
  });
}
