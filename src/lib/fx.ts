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

const KEY_MODE = "fx_mode";
const KEY_RATE = "fx_manual_rate";

/**
 * Wrapped in React's `cache` so a page that formats two hundred prices still
 * reads the settings once. The cache is per-request, so a rate change is
 * visible on the next render rather than after a restart.
 */
export const getFxSettings = cache(async (): Promise<FxSettings> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings WHERE key IN (${KEY_MODE}, ${KEY_RATE})
  `;
  const bag = new Map(rows.map((r) => [r.key, r.value]));

  const rawMode = bag.get(KEY_MODE) ?? "auto";

  return {
    // An unrecognised stored mode reads as auto: the environment rate is the
    // one value that is always present and always deliberate.
    mode: isFxMode(rawMode) ? rawMode : "auto",
    // The validity rule lives in `parseRate`; this is the same bar applied to
    // stored input rather than typed input. A missing row reads as "", which
    // `parseRate` already treats as absent.
    manualRate: parseRate(bag.get(KEY_RATE) ?? ""),
  };
});

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
