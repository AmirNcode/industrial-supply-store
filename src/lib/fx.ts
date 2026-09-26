import "server-only";
import { cache } from "react";
import { sql } from "@/db";
import {
  envFxRate,
  isFxMode,
  parseRate,
  resolveFxRate,
  type FxMode,
  type FxSettings,
} from "./fxRate";
import { parseMarketState, summarizeMarket, type MarketSummary } from "./fxMarket";
import {
  DEFAULT_PRICE_DISPLAY_MODE,
  isPriceDisplayMode,
  type PriceDisplayMode,
} from "./money";

const KEY_MODE = "fx_mode";
const KEY_RATE = "fx_manual_rate";
const KEY_PRICE_DISPLAY = "price_display_mode";
/**
 * The market job's output, split in two on purpose: every priced page reads
 * the rate, a bare number, while only the job and the admin panel read the
 * history behind it.
 */
export const KEY_MARKET_RATE = "fx_market_rate";
export const KEY_MARKET_STATE = "fx_market_state";

type PricingSettings = FxSettings & { priceDisplayMode: PriceDisplayMode };

/**
 * Wrapped in React's `cache` so a page that formats two hundred prices still
 * reads the settings once. The cache is per-request, so a rate change is
 * visible on the next render rather than after a restart.
 */
const getPricingSettings = cache(async (): Promise<PricingSettings> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings
    WHERE key IN (${KEY_MODE}, ${KEY_RATE}, ${KEY_PRICE_DISPLAY}, ${KEY_MARKET_RATE})
  `;
  const bag = new Map(rows.map((r) => [r.key, r.value]));

  const rawMode = bag.get(KEY_MODE) ?? "auto";
  const rawPriceDisplay = bag.get(KEY_PRICE_DISPLAY) ?? DEFAULT_PRICE_DISPLAY_MODE;

  return {
    // An unrecognised stored mode reads as auto: the market rate, or failing
    // that the environment rate, which is always present and deliberate.
    mode: isFxMode(rawMode) ? rawMode : "auto",
    // The validity rule lives in `parseRate`; this is the same bar applied to
    // stored input rather than typed input. A missing row reads as "", which
    // `parseRate` already treats as absent.
    manualRate: parseRate(bag.get(KEY_RATE) ?? ""),
    marketRate: parseRate(bag.get(KEY_MARKET_RATE) ?? ""),
    priceDisplayMode: isPriceDisplayMode(rawPriceDisplay)
      ? rawPriceDisplay
      : DEFAULT_PRICE_DISPLAY_MODE,
  };
});

export async function getFxSettings(): Promise<FxSettings> {
  const { mode, manualRate, marketRate } = await getPricingSettings();
  return { mode, manualRate, marketRate };
}

/** What automatic mode would price at right now, whichever mode is set. */
export async function getAutomaticRate(): Promise<number> {
  return resolveFxRate({ ...(await getFxSettings()), mode: "auto" }, envFxRate());
}

/** The market job's history and health, for the admin panel only. */
export async function getMarketSummary(now = new Date()): Promise<MarketSummary> {
  const [settings, rows] = await Promise.all([
    getFxSettings(),
    sql<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${KEY_MARKET_STATE}`,
  ]);
  return summarizeMarket(parseMarketState(rows[0]?.value), settings.marketRate, now);
}

export async function getPriceDisplayMode(): Promise<PriceDisplayMode> {
  return (await getPricingSettings()).priceDisplayMode;
}

export const getFxRate = cache(async (): Promise<number> => {
  return resolveFxRate(await getFxSettings(), envFxRate());
});

/**
 * Switching to `auto` deliberately leaves any stored manual rate in place, so
 * switching back does not mean retyping it.
 *
 * Callers must not read the settings back through `getFxRate` or
 * `getFxSettings` in the same request after writing: both are memoised per
 * request (via React's `cache`) and would return the pre-write value.
 * Redirect after saving, as `saveFxAction` does, and the next request sees the
 * new rate.
 */
export async function saveFxSettings(
  mode: FxMode,
  manualRate: number | null,
): Promise<void> {
  // Both rows or neither. A failure between two separate statements could
  // leave the mode saying "manual" while the rate is still the old one — the
  // catalog would then be priced at a number nobody chose.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${KEY_MODE}, ${mode}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${mode}, updated_at = now()
    `;
    if (manualRate !== null) {
      await tx`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${KEY_RATE}, ${String(manualRate)}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${String(manualRate)}, updated_at = now()
      `;
    }
  });
}

export async function savePriceDisplayMode(mode: PriceDisplayMode): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY_PRICE_DISPLAY}, ${mode}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${mode}, updated_at = now()
  `;
}
