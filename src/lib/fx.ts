import "server-only";
import { cache } from "react";
import { sql } from "@/db";
import {
  envFxRate,
  isFxMode,
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
  const rawRate = bag.get(KEY_RATE);
  const parsedRate = rawRate === undefined ? Number.NaN : Number(rawRate);

  return {
    // An unrecognised stored mode reads as auto: the environment rate is the
    // one value that is always present and always deliberate.
    mode: isFxMode(rawMode) ? rawMode : "auto",
    manualRate: Number.isFinite(parsedRate) ? parsedRate : null,
  };
});

export const getFxRate = cache(async (): Promise<number> => {
  return resolveFxRate(await getFxSettings(), envFxRate());
});

export async function saveFxSettings(
  mode: FxMode,
  manualRate: number | null,
): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY_MODE}, ${mode}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${mode}, updated_at = now()
  `;
  if (manualRate !== null) {
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${KEY_RATE}, ${String(manualRate)}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${String(manualRate)}, updated_at = now()
    `;
  }
}
