/**
 * The automatic exchange rate: one market reading a day, smoothed.
 *
 * The source is the Tether (USDT) price on Nobitex and Wallex. One Tether is
 * meant to be one US dollar, and Iranians buy it with Rials on these
 * exchanges, so its Rial price is set by the same market as the free-market
 * dollar through thousands of trades a day. Measured against tgju's
 * free-market dollar over the year before this was built, the median gap was
 * 0.03% and nine days in ten were within 3.4%. Both exchanges publish this as
 * a public, keyless API, which is why they were chosen over tgju (its terms
 * require written consent), a paid feed, or a Telegram channel (prices only in
 * an image, and Telegram is blocked inside Iran, where this site will be
 * hosted).
 *
 * The rate is the higher of the latest reading and the average of the past
 * seven days, plus 3%. A plain average trails a rising market by days: on
 * that year's data "average + 3%" priced below the market on 79 of 358 days,
 * worst 7.7% under, while the higher-of rule did so on 15, worst 2.6%.
 *
 * No imports, so every rule here is testable without a network or database.
 * `fxMarketUpdate.ts` does the fetching and the writing.
 */

/** Added on top of the market so a normal week's drift does not eat margin. */
export const RATE_CUSHION = 0.03;
/** Calendar days in the average, counting the latest reading's day. */
export const AVERAGE_DAYS = 7;
/**
 * How far apart the two exchanges may be and still count as agreeing. They
 * normally sit within a few tenths of a percent of each other; a gap past this
 * means one of them is misreporting or has been misread.
 */
export const SOURCES_AGREE = 0.02;
/**
 * The largest day-to-day move accepted when both exchanges confirm it. The
 * biggest real one-day move in the year before this was built was 11.6%, so
 * this leaves room for a genuine shock while refusing a price that is off by a
 * multiple — the Toman/Rial mix-up is a factor of ten.
 */
export const JUMP_CONFIRMED = 0.25;
/** The same, when only one exchange answered and nothing can confirm it. */
export const JUMP_SINGLE = 0.1;
/** Readings kept. The rule needs seven days; the rest is for looking back. */
export const KEEP_READINGS = 30;
/** One missed evening is normal; a day and a half without one is not. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day's accepted price. `rial` is what the rate is built from. */
export type Reading = {
  /** The day in Tehran, `YYYY-MM-DD`. */
  date: string;
  rial: number;
  nobitex: number | null;
  wallex: number | null;
};

export type RefusalReason = "no-source" | "needs-both" | "disagree" | "jump";

export type Attempt = {
  at: string;
  ok: boolean;
  reason: RefusalReason | null;
  nobitex: number | null;
  wallex: number | null;
};

export type MarketState = {
  readings: Reading[];
  lastAttempt: Attempt | null;
  /** When a reading was last accepted. */
  updatedAt: string | null;
};

export type Combined = { ok: true; rial: number } | { ok: false; reason: RefusalReason };

// ---------------------------------------------------------------------------
// Reading the exchanges
// ---------------------------------------------------------------------------

function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Nobitex's last Tether trade, already in Rial (`rls`).
 *
 * A closed market still reports a `latest`, but it is the price from whenever
 * trading stopped, so it is treated as no answer at all.
 */
export function parseNobitex(body: unknown): number | null {
  const market = field(field(body, "stats"), "usdt-rls");
  if (field(market, "isClosed") === true) return null;
  const price = positive(field(market, "latest"));
  return price === null ? null : Math.round(price);
}

/**
 * Wallex's recent Tether trades, in Toman, as one Rial price.
 *
 * The median rather than the newest trade: a single odd fill — a market order
 * sweeping thin depth — is exactly what the newest trade can be.
 */
export function parseWallex(body: unknown): number | null {
  const trades = field(field(body, "result"), "latestTrades");
  if (!Array.isArray(trades)) return null;
  const prices = trades
    .filter((trade) => field(trade, "symbol") === "USDTTMN")
    .map((trade) => positive(field(trade, "price")))
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return Math.round(median * 10);
}

// ---------------------------------------------------------------------------
// Deciding whether a day's price is believable
// ---------------------------------------------------------------------------

function gap(a: number, b: number): number {
  return Math.abs(a - b) / Math.min(a, b);
}

/**
 * Turn the two exchanges' answers into one price, or refuse.
 *
 * `previous` is the latest accepted reading from the past week, or null. With
 * nothing to compare against, only two exchanges agreeing is trusted — one
 * answer alone could be misread by a factor of ten and nothing would notice.
 */
export function combinePrices(
  prices: { nobitex: number | null; wallex: number | null },
  previous: number | null,
): Combined {
  const nobitex = positive(prices.nobitex);
  const wallex = positive(prices.wallex);

  let candidate: number;
  let limit: number;
  if (nobitex !== null && wallex !== null) {
    if (gap(nobitex, wallex) <= SOURCES_AGREE) {
      candidate = Math.round((nobitex + wallex) / 2);
      limit = JUMP_CONFIRMED;
    } else {
      if (previous === null) return { ok: false, reason: "disagree" };
      // One of them is wrong. The one that moved least since yesterday is
      // the likelier to be right, and it still has to pass the single-source
      // limit below.
      candidate =
        Math.abs(nobitex - previous) <= Math.abs(wallex - previous) ? nobitex : wallex;
      limit = JUMP_SINGLE;
    }
  } else if (nobitex !== null || wallex !== null) {
    if (previous === null) return { ok: false, reason: "needs-both" };
    candidate = (nobitex ?? wallex) as number;
    limit = JUMP_SINGLE;
  } else {
    return { ok: false, reason: "no-source" };
  }

  if (previous !== null && gap(candidate, previous) > limit) {
    return { ok: false, reason: "jump" };
  }
  return { ok: true, rial: candidate };
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * The reading a new price is judged against: the latest from the past week.
 *
 * Older than that and it says little about today. A job that silently
 * stopped for a month must be able to start again rather than refusing every
 * price the market has moved to since.
 */
export function anchorFor(readings: readonly Reading[], today: string): number | null {
  const latest = readings.at(-1);
  if (!latest) return null;
  return dayNumber(today) - dayNumber(latest.date) <= AVERAGE_DAYS ? latest.rial : null;
}

// ---------------------------------------------------------------------------
// The rate itself
// ---------------------------------------------------------------------------

/** Readings from the seven calendar days ending on the latest one's day. */
function inWindow(readings: readonly Reading[]): Reading[] {
  const latest = readings.at(-1);
  if (!latest) return [];
  const end = dayNumber(latest.date);
  return readings.filter((r) => end - dayNumber(r.date) < AVERAGE_DAYS);
}

export function windowAverage(readings: readonly Reading[]): number | null {
  const window = inWindow(readings);
  if (window.length === 0) return null;
  return Math.round(window.reduce((sum, r) => sum + r.rial, 0) / window.length);
}

/**
 * Rial per USD: the higher of the latest reading and the week's average,
 * plus the cushion, to the nearest thousand.
 *
 * The first week has fewer than seven readings and averages what it has.
 * Rounding changes a catalog price by at most a few hundred Rial, which the
 * catalog's own nearest-1,000 display rounding swallows anyway.
 */
export function marketRate(readings: readonly Reading[]): number | null {
  const latest = readings.at(-1);
  const average = windowAverage(readings);
  if (!latest || average === null) return null;
  const base = Math.max(latest.rial, average);
  return Math.round((base * (1 + RATE_CUSHION)) / 1_000) * 1_000;
}

/** Add a day's reading; a second run on the same day replaces the first. */
export function upsertReading(readings: readonly Reading[], reading: Reading): Reading[] {
  return [...readings.filter((r) => r.date !== reading.date), reading]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-KEEP_READINGS);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Days are Tehran days. The job runs in the evening there, which is still the
 * same date in UTC — but only by three and a half hours, and a late run near
 * midnight would otherwise file a reading under the wrong day.
 */
const tehranDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const tehranClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function tehranDate(now: Date): string {
  return tehranDay.format(now);
}

/** `YYYY-MM-DD HH:MM` in Tehran, for the admin panel. */
export function tehranStamp(iso: string): string {
  const at = new Date(iso);
  return `${tehranDay.format(at)} ${tehranClock.format(at)}`;
}

export function isStale(updatedAt: string | null, now: Date): boolean {
  if (updatedAt === null) return false;
  return now.getTime() - Date.parse(updatedAt) > STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const REASONS: readonly RefusalReason[] = ["no-source", "needs-both", "disagree", "jump"];

function priceOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function readReading(value: unknown): Reading | null {
  const date = field(value, "date");
  const rial = priceOrNull(field(value, "rial"));
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || rial === null) {
    return null;
  }
  return {
    date,
    rial,
    nobitex: priceOrNull(field(value, "nobitex")),
    wallex: priceOrNull(field(value, "wallex")),
  };
}

function readAttempt(value: unknown): Attempt | null {
  const at = isoOrNull(field(value, "at"));
  const ok = field(value, "ok");
  if (at === null || typeof ok !== "boolean") return null;
  const reason = field(value, "reason");
  return {
    at,
    ok,
    reason: REASONS.includes(reason as RefusalReason) ? (reason as RefusalReason) : null,
    nobitex: priceOrNull(field(value, "nobitex")),
    wallex: priceOrNull(field(value, "wallex")),
  };
}

/**
 * Read the stored state back, dropping anything malformed.
 *
 * It lives as JSON in `app_settings`, so a hand edit or an older shape is
 * possible. A bad row is dropped rather than allowed to drag the average, and
 * an unreadable document is an empty history — the next evening starts it
 * again, and until then the site keeps its current rate.
 */
export function parseMarketState(raw: string | undefined): MarketState {
  const empty: MarketState = { readings: [], lastAttempt: null, updatedAt: null };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  const rows = field(parsed, "readings");
  const readings = (Array.isArray(rows) ? rows : [])
    .map(readReading)
    .filter((r): r is Reading => r !== null);
  return {
    readings: upsertAll(readings),
    lastAttempt: readAttempt(field(parsed, "lastAttempt")),
    updatedAt: isoOrNull(field(parsed, "updatedAt")),
  };
}

function upsertAll(readings: Reading[]): Reading[] {
  return readings.reduce<Reading[]>((all, r) => upsertReading(all, r), []);
}

export function serializeMarketState(state: MarketState): string {
  return JSON.stringify(state);
}

// ---------------------------------------------------------------------------
// What the admin panel shows
// ---------------------------------------------------------------------------

export type MarketSummary = {
  /** The stored automatic rate, or null before the first accepted reading. */
  rate: number | null;
  latest: Reading | null;
  average: number | null;
  updatedAt: string | null;
  /** Set when the most recent attempt failed after the last success. */
  failedReason: RefusalReason | null;
  failedAt: string | null;
  stale: boolean;
};

export function summarizeMarket(
  state: MarketState,
  rate: number | null,
  now: Date,
): MarketSummary {
  const attempt = state.lastAttempt;
  const failedSinceSuccess =
    attempt !== null &&
    !attempt.ok &&
    (state.updatedAt === null || Date.parse(attempt.at) > Date.parse(state.updatedAt));
  return {
    rate,
    latest: state.readings.at(-1) ?? null,
    average: windowAverage(state.readings),
    updatedAt: state.updatedAt,
    failedReason: failedSinceSuccess ? attempt.reason : null,
    failedAt: failedSinceSuccess ? attempt.at : null,
    stale: isStale(state.updatedAt, now),
  };
}
