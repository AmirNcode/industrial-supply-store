/**
 * Exchange rate policy, kept free of imports so it can be tested without a
 * database. `lib/fx.ts` supplies the stored settings; this module decides what
 * they mean.
 */

export const FX_MODES = ["auto", "manual"] as const;
export type FxMode = (typeof FX_MODES)[number];

export type FxSettings = {
  mode: FxMode;
  /** Toman per USD. Null when never set. */
  manualRate: number | null;
};

/** Used only when the environment value is missing or unparseable. */
export const DEFAULT_FX_RATE = 110000;

export function isFxMode(v: string): v is FxMode {
  return (FX_MODES as readonly string[]).includes(v);
}

export function envFxRate(): number {
  const n = Number(process.env.USD_TO_TOMAN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FX_RATE;
}

/**
 * Manual mode falls back to the environment rate when the stored value is
 * unusable. The alternative — returning zero or NaN — would render every
 * Persian price as free, which is worse than a stale rate and harder to spot.
 */
export function resolveFxRate(settings: FxSettings, envRate: number): number {
  const env = Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_FX_RATE;
  if (settings.mode !== "manual") return env;
  const manual = settings.manualRate;
  return typeof manual === "number" && Number.isFinite(manual) && manual > 0
    ? manual
    : env;
}

/**
 * A typo in this field reprices the whole catalog and looks exactly like a
 * deliberate change. One order of magnitude either way is wide enough for any
 * real currency move and narrow enough to catch a stray zero.
 */
export function isPlausibleRate(rate: number, envRate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const env = Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_FX_RATE;
  return rate >= env / 10 && rate <= env * 10;
}

/** Accepts what someone actually types, including thousands separators. */
export function parseRate(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s٬،]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}
