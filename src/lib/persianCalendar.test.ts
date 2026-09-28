import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPersianDate,
  formatPersianDay,
  persianMonthLabel,
  persianYearMonth,
  tehranDatePlusDays,
  tehranToday,
} from "./persianCalendar";

test("Nowruz 1405 falls on 21 March 2026 in Tehran", () => {
  assert.deepEqual(persianYearMonth(new Date("2026-03-21T08:30:00Z")), { year: 1405, month: 1 });
  assert.deepEqual(persianYearMonth(new Date("2026-03-20T12:00:00Z")), { year: 1404, month: 12 });
});

test("a month turns at Tehran midnight, not at UTC midnight", () => {
  // 23:59 in Tehran on 31 Shahrivar 1405.
  assert.deepEqual(persianYearMonth(new Date("2026-09-22T20:29:00Z")), { year: 1405, month: 6 });
  // 00:01 in Tehran on 1 Mehr 1405 — still 22 September in UTC.
  assert.deepEqual(persianYearMonth(new Date("2026-09-22T20:31:00Z")), { year: 1405, month: 7 });
});

test("dates and months read naturally in each language", () => {
  assert.equal(formatPersianDate("2026-09-26T12:00:00Z", "fa"), "۴ مهر ۱۴۰۵");
  assert.equal(formatPersianDate("2026-09-26T12:00:00Z", "en"), "4 Mehr 1405");
  assert.equal(formatPersianDay("2026-09-23", "en"), "1 Mehr 1405");
  assert.equal(persianMonthLabel({ year: 1405, month: 12 }, "en"), "Esfand 1405");
  assert.equal(persianMonthLabel({ year: 1405, month: 7 }, "fa"), "مهر ۱۴۰۵");
});

test("today and follow-up dates are Tehran calendar days", () => {
  // 00:30 in Tehran on 27 September is still 21:00 UTC on the 26th.
  const justAfterMidnight = new Date("2026-09-26T21:00:00Z");
  assert.equal(tehranToday(justAfterMidnight), "2026-09-27");
  assert.equal(tehranDatePlusDays(1, justAfterMidnight), "2026-09-28");
  assert.equal(tehranDatePlusDays(7, justAfterMidnight), "2026-10-04");
  assert.equal(tehranDatePlusDays(30, justAfterMidnight), "2026-10-27");
});
