import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryNodeKey,
  familyNodeKey,
  moveSibling,
  normalizeTaxonomyName,
  parseTaxonomyNodeKey,
  reconcileSiblingOrder,
  setVisibilityDraft,
  sameOrder,
} from "./adminTaxonomy";

test("category and family ids remain distinct in URL state", () => {
  assert.equal(categoryNodeKey(12), "c:12");
  assert.equal(familyNodeKey(12), "f:12");
  assert.equal(parseTaxonomyNodeKey("c:12"), "c:12");
  assert.equal(parseTaxonomyNodeKey("f:12"), "f:12");
});

test("malformed taxonomy keys are refused", () => {
  for (const value of [null, "", "12", "c:0", "f:-1", "x:2", "c:2.5", "c:NaN"]) {
    assert.equal(parseTaxonomyNodeKey(value), null);
  }
});

test("a sibling move is adjacent and cannot cross its scope", () => {
  assert.deepEqual(moveSibling([2, 4, 6], 4, -1), [4, 2, 6]);
  assert.deepEqual(moveSibling([2, 4, 6], 4, 1), [2, 6, 4]);
  assert.deepEqual(moveSibling([2, 4, 6], 2, -1), [2, 4, 6]);
  assert.deepEqual(moveSibling([2, 4, 6], 8, 1), [2, 4, 6]);
});

test("dirty order means different from the server, not merely touched", () => {
  assert.equal(sameOrder([1, 2, 3], [1, 2, 3]), true);
  assert.equal(sameOrder([1, 3, 2], [1, 2, 3]), false);
  assert.equal(sameOrder([1, 2], [1, 2, 3]), false);
});

test("sibling duplicate names ignore case and whitespace runs", () => {
  assert.equal(normalizeTaxonomyName("  Gate   Valves "), "gate valves");
  assert.equal(normalizeTaxonomyName("GATE VALVES"), "gate valves");
});

test("a refreshed sibling list preserves local intent and appends new rows", () => {
  assert.deepEqual(reconcileSiblingOrder([3, 1, 2], [1, 2, 3, 4]), [3, 1, 2, 4]);
  assert.deepEqual(reconcileSiblingOrder([3, 1, 2], [1, 3, 4]), [3, 1, 4]);
});

test("visibility is dirty only while it differs from the database", () => {
  const hidden = setVisibilityDraft({}, "c:7", true, false);
  assert.deepEqual(hidden, { "c:7": false });
  assert.deepEqual(setVisibilityDraft(hidden, "c:7", true, true), {});

  const visible = setVisibilityDraft({}, "f:9", false, true);
  assert.deepEqual(visible, { "f:9": true });
  assert.deepEqual(setVisibilityDraft(visible, "f:9", false, false), {});
  assert.deepEqual(hidden, { "c:7": false }, "the setter must not mutate earlier drafts");
});
