import { test } from "node:test";
import assert from "node:assert/strict";
import { leadRepId, parseSharePercent, resolveShares, splitProblem } from "./commissionSplit";

test("splitProblem", () => {
  const r = (id: string, bp: number | null) => ({ repId: id, shareBp: bp });
  assert.equal(splitProblem([r("a", null)]), null);
  assert.equal(splitProblem([r("a", 7500), r("b", 1500), r("c", 1000)]), null);
  assert.equal(splitProblem([r("a", null), r("b", null), r("c", null)]), null);
  assert.equal(splitProblem([r("a", 7500), r("b", null)]), "mixed");
  assert.equal(splitProblem([r("a", 7500), r("b", 1500)]), "total");
  assert.equal(splitProblem([r("a", 5000), r("a", 5000)]), "duplicate");
  assert.equal(splitProblem(["a", "b", "c", "d", "e", "f"].map((id) => r(id, null))), "too-many");
  assert.equal(splitProblem([]), "empty");
});

test("resolveShares: equal thirds give the extra to the first", () => {
  assert.deepEqual(
    resolveShares([{ repId: "a", shareBp: null }, { repId: "b", shareBp: null }, { repId: "c", shareBp: null }]),
    [{ repId: "a", shareBp: 3334 }, { repId: "b", shareBp: 3333 }, { repId: "c", shareBp: 3333 }],
  );
});

test("leadRepId: biggest share, earliest on a tie", () => {
  assert.equal(leadRepId([{ repId: "a", shareBp: 2500 }, { repId: "b", shareBp: 7500 }]), "b");
  assert.equal(leadRepId([{ repId: "a", shareBp: 5000 }, { repId: "b", shareBp: 5000 }]), "a");
  assert.equal(leadRepId([{ repId: "a", shareBp: null }, { repId: "b", shareBp: null }]), "a");
  assert.equal(leadRepId([]), null);
});

test("parseSharePercent", () => {
  assert.equal(parseSharePercent(""), null);
  assert.equal(parseSharePercent("   "), null);
  assert.equal(parseSharePercent("75"), 7500);
  assert.equal(parseSharePercent(" ۷۵ "), 7500);
  assert.equal(parseSharePercent("100"), 10000);
  for (const bad of ["0", "-5", "75.5", "101", "abc", "7 5"]) assert.equal(parseSharePercent(bad), "invalid");
});
