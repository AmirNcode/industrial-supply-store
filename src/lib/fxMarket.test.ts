import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorFor,
  combinePrices,
  isStale,
  marketRate,
  parseMarketState,
  parseNobitex,
  parseWallex,
  serializeMarketState,
  summarizeMarket,
  tehranDate,
  tehranStamp,
  upsertReading,
  windowAverage,
  type Reading,
} from "./fxMarket";

const reading = (date: string, rial: number): Reading => ({
  date,
  rial,
  nobitex: rial,
  wallex: rial,
});

// The seven tgju closing rates up to 2026-09-24, the week this was designed on.
const WEEK = [
  reading("2026-09-16", 2_305_000),
  reading("2026-09-17", 2_279_000),
  reading("2026-09-19", 2_302_750),
  reading("2026-09-20", 2_306_000),
  reading("2026-09-21", 2_308_000),
  reading("2026-09-22", 2_332_000),
  reading("2026-09-23", 2_317_050),
  reading("2026-09-24", 2_346_150),
];

// ---------------------------------------------------------------------------
// Reading the exchanges
// ---------------------------------------------------------------------------

test("Nobitex's last Tether trade is read in Rial", () => {
  const body = {
    status: "ok",
    stats: { "usdt-rls": { isClosed: false, latest: "2343800", mark: "2343920" } },
  };
  assert.equal(parseNobitex(body), 2_343_800);
});

test("a closed, missing or garbled Nobitex market reads as no price", () => {
  assert.equal(parseNobitex({ stats: { "usdt-rls": { isClosed: true, latest: "2343800" } } }), null);
  assert.equal(parseNobitex({ stats: {} }), null);
  assert.equal(parseNobitex({ stats: { "usdt-rls": { latest: "n/a" } } }), null);
  assert.equal(parseNobitex({ stats: { "usdt-rls": { latest: "0" } } }), null);
  assert.equal(parseNobitex(null), null);
  assert.equal(parseNobitex("<html>blocked</html>"), null);
});

test("Wallex quotes Toman, so its median recent trade is multiplied into Rial", () => {
  const trade = (price: string) => ({ symbol: "USDTTMN", price, quantity: "10" });
  const body = {
    result: {
      latestTrades: [trade("234170.00"), trade("234100.00"), trade("260000.00")],
    },
  };
  // The median ignores the one stray fill at 260,000.
  assert.equal(parseWallex(body), 2_341_700);
});

test("Wallex trades from another market or with no price are ignored", () => {
  assert.equal(
    parseWallex({
      result: {
        latestTrades: [
          { symbol: "BTCTMN", price: "9000000000" },
          { symbol: "USDTTMN", price: "abc" },
        ],
      },
    }),
    null,
  );
  assert.equal(parseWallex({ result: { latestTrades: [] } }), null);
  assert.equal(parseWallex({}), null);
});

// ---------------------------------------------------------------------------
// Deciding whether a day's price is believable
// ---------------------------------------------------------------------------

test("two exchanges that agree are averaged", () => {
  assert.deepEqual(combinePrices({ nobitex: 2_343_800, wallex: 2_340_500 }, 2_320_000), {
    ok: true,
    rial: 2_342_150,
  });
});

test("the very first reading is accepted only when both exchanges agree", () => {
  assert.deepEqual(combinePrices({ nobitex: 2_343_800, wallex: 2_340_500 }, null), {
    ok: true,
    rial: 2_342_150,
  });
  // One answer alone has nothing to be checked against.
  assert.deepEqual(combinePrices({ nobitex: 2_343_800, wallex: null }, null), {
    ok: false,
    reason: "needs-both",
  });
  assert.deepEqual(combinePrices({ nobitex: 2_343_800, wallex: 2_600_000 }, null), {
    ok: false,
    reason: "disagree",
  });
});

test("when the exchanges disagree, the one nearer yesterday wins", () => {
  // Wallex read in Toman by mistake: ten times too small. The cross-check
  // catches it rather than repricing the catalog at a tenth.
  assert.deepEqual(combinePrices({ nobitex: 2_343_800, wallex: 234_050 }, 2_320_000), {
    ok: true,
    rial: 2_343_800,
  });
});

test("one exchange down still updates, within the tighter single-source limit", () => {
  assert.deepEqual(combinePrices({ nobitex: null, wallex: 2_340_500 }, 2_320_000), {
    ok: true,
    rial: 2_340_500,
  });
  // 12% in a day on one unconfirmed source is refused.
  assert.deepEqual(combinePrices({ nobitex: null, wallex: 2_600_000 }, 2_320_000), {
    ok: false,
    reason: "jump",
  });
});

test("a large move both exchanges confirm is accepted, an absurd one is not", () => {
  // The biggest one-day move in the year before this was built was 11.6%.
  assert.equal(combinePrices({ nobitex: 2_600_000, wallex: 2_610_000 }, 2_320_000).ok, true);
  assert.deepEqual(combinePrices({ nobitex: 3_100_000, wallex: 3_110_000 }, 2_320_000), {
    ok: false,
    reason: "jump",
  });
});

test("no answer from either exchange is a failure, not a zero", () => {
  assert.deepEqual(combinePrices({ nobitex: null, wallex: null }, 2_320_000), {
    ok: false,
    reason: "no-source",
  });
});

test("the anchor is the latest reading from the past week, not an old one", () => {
  assert.equal(anchorFor(WEEK, "2026-09-25"), 2_346_150);
  // A job that stopped for a fortnight should not be judged against prices
  // the market left behind long ago.
  assert.equal(anchorFor(WEEK, "2026-10-10"), null);
  assert.equal(anchorFor([], "2026-09-25"), null);
});

// ---------------------------------------------------------------------------
// The rate itself
// ---------------------------------------------------------------------------

test("in a rising week the latest reading sets the rate, plus 3%", () => {
  // Average 2,318,658; latest 2,346,150 is higher; × 1.03 = 2,416,534.5.
  assert.equal(marketRate(WEEK), 2_417_000);
});

test("after a one-day spike falls back, the week's average holds the rate up", () => {
  const spikeThenDrop = [
    reading("2026-09-20", 2_300_000),
    reading("2026-09-21", 2_300_000),
    reading("2026-09-22", 2_300_000),
    reading("2026-09-23", 2_300_000),
    reading("2026-09-24", 2_800_000),
    reading("2026-09-25", 2_300_000),
    reading("2026-09-26", 2_100_000),
  ];
  // Average 2,342,857 beats the latest 2,100,000; × 1.03 = 2,413,143.
  assert.equal(marketRate(spikeThenDrop), 2_413_000);
});

test("the average covers the last seven calendar days only", () => {
  // The window is 09-18 to 09-24. The 16th and 17th fall outside it, and the
  // market's closed 18th simply has no reading.
  assert.equal(windowAverage(WEEK), 2_318_658);
  assert.equal(windowAverage([]), null);
});

test("the first days use however many readings exist", () => {
  assert.equal(marketRate([reading("2026-09-26", 2_342_150)]), 2_412_000);
  assert.equal(marketRate([]), null);
});

test("re-running a day replaces that day's reading and history stays bounded", () => {
  const again = upsertReading(WEEK, reading("2026-09-24", 2_350_000));
  assert.equal(again.length, WEEK.length);
  assert.equal(again.at(-1)?.rial, 2_350_000);

  let many: Reading[] = [];
  for (let d = 0; d < 40; d++) {
    const date = new Date(Date.UTC(2026, 7, 1 + d)).toISOString().slice(0, 10);
    many = upsertReading(many, reading(date, 2_000_000 + d));
  }
  assert.equal(many.length, 30);
  assert.equal(many[0].date, "2026-08-11");
  assert.equal(many.at(-1)?.date, "2026-09-09");
});

// ---------------------------------------------------------------------------
// Time and storage
// ---------------------------------------------------------------------------

test("a reading is dated by the day in Tehran, not in UTC", () => {
  // Tehran is UTC+3:30, so its midnight is 20:30 UTC the evening before.
  assert.equal(tehranDate(new Date("2026-09-26T20:29:00Z")), "2026-09-26");
  assert.equal(tehranDate(new Date("2026-09-26T20:31:00Z")), "2026-09-27");
  assert.equal(tehranStamp("2026-09-26T17:35:00Z"), "2026-09-26 21:05");
});

test("a rate is stale once it is more than a day and a half old", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(isStale("2026-09-27T12:00:00Z", now), false);
  assert.equal(isStale("2026-09-26T23:00:00Z", now), true);
  assert.equal(isStale(null, now), false);
});

test("stored state survives a round trip and garbage reads as empty", () => {
  const state = {
    readings: WEEK,
    lastAttempt: {
      at: "2026-09-24T17:35:00Z",
      ok: true,
      reason: null,
      nobitex: 2_346_000,
      wallex: 2_346_300,
    },
    updatedAt: "2026-09-24T17:35:00Z",
  };
  assert.deepEqual(parseMarketState(serializeMarketState(state)), state);
  assert.deepEqual(parseMarketState(undefined), { readings: [], lastAttempt: null, updatedAt: null });
  assert.deepEqual(parseMarketState("{not json"), { readings: [], lastAttempt: null, updatedAt: null });
  // One bad row is dropped rather than poisoning the average.
  const mixed = JSON.stringify({ readings: [WEEK[0], { date: "x", rial: -1 }], updatedAt: 5 });
  assert.deepEqual(parseMarketState(mixed).readings, [WEEK[0]]);
  assert.equal(parseMarketState(mixed).updatedAt, null);
});

test("the admin summary reports a failure newer than the last success", () => {
  const now = new Date("2026-09-25T18:00:00Z");
  const failed = summarizeMarket(
    {
      readings: WEEK,
      updatedAt: "2026-09-24T17:35:00Z",
      lastAttempt: {
        at: "2026-09-25T17:35:00Z",
        ok: false,
        reason: "disagree",
        nobitex: 2_350_000,
        wallex: 2_900_000,
      },
    },
    2_417_000,
    now,
  );
  assert.equal(failed.rate, 2_417_000);
  assert.equal(failed.failedReason, "disagree");
  assert.equal(failed.stale, false);
  assert.equal(failed.latest?.date, "2026-09-24");

  const fine = summarizeMarket(
    { readings: WEEK, updatedAt: "2026-09-24T17:35:00Z", lastAttempt: null },
    2_417_000,
    now,
  );
  assert.equal(fine.failedReason, null);
});
