/**
 * Exchange rate policy, kept free of imports so it can be tested without a
 * database. `lib/fx.ts` supplies the stored settings; this module decides what
 * they mean.
 */

export const FX_MODES = ["auto", "manual"] as const;
export type FxMode = (typeof FX_MODES)[number];

export type FxSettings = {
  mode: FxMode;
  /** Rial per USD. Null when never set. */
  manualRate: number | null;
};

/** Used only when the environment value is missing or unparseable. */
export const DEFAULT_FX_RATE = 1_100_000;

export function isFxMode(v: string): v is FxMode {
  return (FX_MODES as readonly string[]).includes(v);
}

export function configuredFxRate(
  rialValue: string | undefined,
  legacyTomanValue: string | undefined,
): number {
  const rial = Number(rialValue);
  if (Number.isFinite(rial) && rial > 0) return rial;

  // One-release compatibility for deployments that have not renamed their
  // environment variable yet. All internal values are still Rial: the legacy
  // Toman input is converted at the boundary and never leaves this function.
  const legacyToman = Number(legacyTomanValue);
  if (Number.isFinite(legacyToman) && legacyToman > 0) return legacyToman * 10;

  return DEFAULT_FX_RATE;
}

export function envFxRate(): number {
  return configuredFxRate(process.env.USD_TO_RIAL, process.env.USD_TO_TOMAN);
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

/**
 * Persian (۰-۹) and Arabic-Indic (٠-٩) digits map to their Latin equivalents.
 *
 * The admin panel is available in Persian, so a Persian keyboard produces
 * these by default. `Number("۱۴۵۰۰۰")` is NaN, which made a correctly typed
 * rate read as unparseable — and the rejection message says nothing about
 * which digits are acceptable.
 */
function latinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** Accepts what someone actually types, including thousands separators. */
export function parseRate(raw: string): number | null {
  const cleaned = latinDigits(raw.trim()).replace(/[,\s٬،]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}
