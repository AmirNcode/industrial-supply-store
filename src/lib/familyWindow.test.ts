import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILY_INITIAL_ROWS,
  FAMILY_MAX_PROGRESSIVE_ROWS,
  nextFamilyRows,
  parseFamilyWindow,
} from "./familyWindow";
import { clearAllHref, familyWindowHref, parseFilters, toggleHref } from "./filters";
import { REQUEST_LIMITS } from "./requestLimits";

test("family pages start with a bounded result window", () => {
  assert.deepEqual(parseFamilyWindow({}), {
    showAll: false,
    rows: FAMILY_INITIAL_ROWS,
  });
});

test("family row requests are normalized and capped", () => {
  assert.equal(parseFamilyWindow({ rows: "101" }).rows, 200);
  assert.equal(parseFamilyWindow({ rows: "250" }).rows, 300);
  assert.equal(
    parseFamilyWindow({ rows: "999999" }).rows,
    FAMILY_MAX_PROGRESSIVE_ROWS,
  );

  for (const rows of ["0", "-1", "1.5", "Infinity", "not-a-number"]) {
    assert.equal(parseFamilyWindow({ rows }).rows, FAMILY_INITIAL_ROWS);
  }
  assert.equal(
    parseFamilyWindow({ rows: ["200", "500"] }).rows,
    FAMILY_INITIAL_ROWS,
  );
});

test("rendering every row requires the explicit all-products mode", () => {
  assert.deepEqual(parseFamilyWindow({ view: "all", rows: "500" }), {
    showAll: true,
    rows: null,
  });
  assert.equal(parseFamilyWindow({ view: ["all", "all"] }).showAll, false);
});

test("the next family window grows predictably and stops at its cap", () => {
  assert.equal(nextFamilyRows(100, 2_400), 200);
  assert.equal(nextFamilyRows(400, 450), 500);
  assert.equal(nextFamilyRows(500, 2_400), null);
  assert.equal(nextFamilyRows(100, 80), null);
});

test("family window links preserve filters and part-number targets", () => {
  const base = "/en/f/socket-head-cap-screws";
  const current = {
    f_material: "Steel",
    pn: "1000A1",
    page: "9",
    rows: "400",
    view: "all",
  };

  const more = new URL(familyWindowHref(base, current, 500), "https://example.test");
  assert.equal(more.searchParams.get("f_material"), "Steel");
  assert.equal(more.searchParams.get("pn"), "1000A1");
  assert.equal(more.searchParams.get("rows"), "500");
  assert.equal(more.searchParams.has("view"), false);
  assert.equal(more.searchParams.has("page"), false);

  const all = new URL(familyWindowHref(base, current, "all"), "https://example.test");
  assert.equal(all.searchParams.get("view"), "all");
  assert.equal(all.searchParams.has("rows"), false);

  const initial = new URL(familyWindowHref(base, current, null), "https://example.test");
  assert.equal(initial.searchParams.has("rows"), false);
  assert.equal(initial.searchParams.has("view"), false);
});

test("changing a facet resets a large or all-products family window", () => {
  const href = new URL(
    toggleHref(
      "/en/f/socket-head-cap-screws",
      { f_material: "Steel", pn: "1000A1", rows: "500", view: "all" },
      "finish",
      "Black Oxide",
    ),
    "https://example.test",
  );

  assert.equal(href.searchParams.get("pn"), "1000A1");
  assert.equal(href.searchParams.get("f_material"), "Steel");
  assert.equal(href.searchParams.get("f_finish"), "Black Oxide");
  assert.equal(href.searchParams.has("rows"), false);
  assert.equal(href.searchParams.has("view"), false);
});

test("filter parsing bounds predicate count and hostile values", () => {
  const submitted = Object.fromEntries(
    Array.from({ length: REQUEST_LIMITS.filterKeys + 5 }, (_, index) => [
      `f_key_${index}`,
      Array.from(
        { length: REQUEST_LIMITS.filterValuesPerKey + 5 },
        (__, value) => value === 0 ? "x".repeat(REQUEST_LIMITS.filterValueChars + 1) : `v-${value}`,
      ),
    ]),
  );
  const parsed = parseFilters(submitted);
  assert.ok(Object.keys(parsed).length <= REQUEST_LIMITS.filterKeys);
  assert.ok(Object.values(parsed).every((values) => values.length <= REQUEST_LIMITS.filterValuesPerKey));
  assert.ok(
    Object.values(parsed).reduce((count, values) => count + values.length, 0) <=
      REQUEST_LIMITS.filterValuesTotal,
  );
  assert.ok(Object.values(parsed).flat().every((value) => value.length <= REQUEST_LIMITS.filterValueChars));

  const manyKeys = Object.fromEntries(
    Array.from({ length: REQUEST_LIMITS.filterKeys + 5 }, (_, index) => [
      `f_single_${index}`,
      `v-${index}`,
    ]),
  );
  assert.equal(Object.keys(parseFilters(manyKeys)).length, REQUEST_LIMITS.filterKeys);
});

test("family links do not reflect rejected filters or arbitrary query parameters", () => {
  const base = "/en/f/socket-head-cap-screws";
  const hostile = Object.fromEntries(
    Array.from({ length: REQUEST_LIMITS.filterKeys + 10 }, (_, index) => [
      `f_key_${index}`,
      `value-${index}`,
    ]),
  );
  const href = new URL(
    familyWindowHref(
      base,
      {
        ...hostile,
        tracking_blob: "x".repeat(10_000),
        pn: "1000A1",
      },
      200,
    ),
    "https://example.test",
  );

  assert.equal(href.searchParams.get("pn"), "1000A1");
  assert.equal(href.searchParams.get("rows"), "200");
  assert.equal(href.searchParams.has("tracking_blob"), false);
  assert.equal(
    [...href.searchParams.keys()].filter((key) => key.startsWith("f_")).length,
    REQUEST_LIMITS.filterKeys,
  );

  const cleared = new URL(
    clearAllHref(base, { f_material: "Steel", pn: "1000A1", surprise: "kept-before" }),
    "https://example.test",
  );
  assert.deepEqual([...cleared.searchParams.entries()], [["pn", "1000A1"]]);
});
