/**
 * Exchange rate policy, kept free of database imports so it can be tested
 * without a database. `lib/fx.ts` supplies the stored settings; this module
 * decides what they mean.
 */

import { latinDigits } from "./digits";

export const FX_MODES = ["auto", "manual"] as const;
export type FxMode = (typeof FX_MODES)[number];

export type FxSettings = {
  mode: FxMode;
  /** Rial per USD. Null when never set. */
  manualRate: number | null;
  /**
   * Rial per USD from the daily market job (`fxMarket.ts`). Null until its
   * first accepted reading, which is the only time automatic mode still
   * reads the environment rate.
   */
  marketRate: number | null;
};

/**
 * Used only when the environment value is missing or unparseable — a
 * placeholder so a page can render, never a rate to bill at. `fxRateSource`
 * reports when it is in use; invoices refuse it and admin says so.
 */
export const DEFAULT_FX_RATE = 1_100_000;

export function isFxMode(v: string): v is FxMode {
  return (FX_MODES as readonly string[]).includes(v);
}

export function configuredFxRate(
  rialValue: string | undefined,
  legacyTomanValue: string | undefined,
): number {
  // Whole rial only: invoices convert with BigInt, which throws on 1250000.5
  // and took every invoice page down with it (review L-7).
  const rial = Number(rialValue);
  if (Number.isSafeInteger(rial) && rial > 0) return rial;

  // One-release compatibility for deployments that have not renamed their
  // environment variable yet. All internal values are still Rial: the legacy
  // Toman input is converted at the boundary and never leaves this function.
  const legacyToman = Number(legacyTomanValue);
  if (Number.isSafeInteger(legacyToman * 10) && legacyToman > 0) return legacyToman * 10;

  return DEFAULT_FX_RATE;
}

export function envFxRate(): number {
  return configuredFxRate(process.env.USD_TO_RIAL, process.env.USD_TO_TOMAN);
}

/**
 * Whether the environment names a rate at all, rather than leaving the
 * placeholder. Both values are passed in, as `configuredFxRate` takes them:
 * defaulting them from `process.env` made an explicit `undefined` ("not set")
 * read the real environment instead, so the answer depended on the machine.
 */
export function hasConfiguredFxRate(
  rialValue: string | undefined,
  legacyTomanValue: string | undefined,
): boolean {
  const rial = Number(rialValue);
  const toman = Number(legacyTomanValue);
  return (Number.isSafeInteger(rial) && rial > 0) || (Number.isSafeInteger(toman * 10) && toman > 0);
}

/**
 * Where the rate in use came from. "env" is the deployment's own fallback,
 * used in automatic mode before the first market reading; "placeholder" is
 * `DEFAULT_FX_RATE`, which nobody chose — about half the market rate when it
 * was last checked. A fresh self-hosted database starts there (review H-7).
 */
export type FxRateSource = "market" | "manual" | "env" | "placeholder";

export function fxRateSource(settings: FxSettings, envConfigured: boolean): FxRateSource {
  const chosen = settings.mode === "manual" ? settings.manualRate : settings.marketRate;
  if (usable(chosen)) return settings.mode === "manual" ? "manual" : "market";
  return envConfigured ? "env" : "placeholder";
}

function usable(rate: number | null): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/**
 * Automatic mode is the market rate; manual mode is the typed rate.
 *
 * Either falls back to the environment rate when its own value is unusable —
 * before the market job's first reading, or a corrupt manual row. The
 * alternative, zero or NaN, would render every Persian price as free, which
 * is worse than a stale rate and harder to spot.
 */
export function resolveFxRate(settings: FxSettings, envRate: number): number {
  const env = Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_FX_RATE;
  const chosen = settings.mode === "manual" ? settings.manualRate : settings.marketRate;
  return usable(chosen) ? chosen : env;
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

/**
 * Persian (۰-۹) and Arabic-Indic (٠-٩) digits map to their Latin equivalents.
 *
 * The admin panel is available in Persian, so a Persian keyboard produces
 * these by default. `Number("۱۴۵۰۰۰")` is NaN, which made a correctly typed
 * rate read as unparseable — and the rejection message says nothing about
 * which digits are acceptable.
 */
/** Accepts what someone actually types, including thousands separators. */
export function parseRate(raw: string): number | null {
  const cleaned = latinDigits(raw.trim()).replace(/[,\s٬،]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}
