import assert from "node:assert/strict";
import { test } from "node:test";
import { META_DESCRIPTION_MAX, clampDescription, familyDescription, fillMeta } from "./pageMeta";

test("a short description is kept whole", () => {
  assert.equal(clampDescription("  Ball valves  for\nwater lines "), "Ball valves for water lines");
});

test("a long description is cut at a word, never mid-word", () => {
  const long = "word ".repeat(60);
  const out = clampDescription(long);
  assert.ok(out.length <= META_DESCRIPTION_MAX);
  assert.ok(out.endsWith("word…"));
});

test("dictionary holes are filled and unknown ones left visible", () => {
  assert.equal(fillMeta("{name}: {count} parts {x}", { name: "Pipe", count: "12" }), "Pipe: 12 parts {x}");
});

test("a family description does not end up with two full stops", () => {
  assert.equal(
    familyDescription("{desc}. {count} models.", "Bourdon-tube dial gauges.", "Pressure Gauges", "40"),
    "Bourdon-tube dial gauges. 40 models.",
  );
});

test("a family with no short description is described by its name", () => {
  assert.equal(
    familyDescription("{desc}. {count} models.", "  ", "API 6A Gate Valve", "10"),
    "API 6A Gate Valve. 10 models.",
  );
});
