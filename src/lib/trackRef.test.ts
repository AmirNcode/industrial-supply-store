import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseRef } from "./trackRef";

test("a well-formed reference passes through uppercased", () => {
  assert.equal(normaliseRef("ORD-7Q4M2X"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("ord-7q4m2x"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("  ORD-7Q4M2X  "), "ORD-7Q4M2X");
});

test("the prefix is optional, because people read out the part after it", () => {
  assert.equal(normaliseRef("7Q4M2X"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("7q4m2x"), "ORD-7Q4M2X");
});

test("the old RFQ prefix is accepted and translated", () => {
  // References issued before the rename are printed on confirmations people
  // still have. Rejecting them would be technically correct and useless.
  assert.equal(normaliseRef("RFQ-7Q4M2X"), "ORD-7Q4M2X");
});

test("anything not of that shape is refused", () => {
  assert.equal(normaliseRef(""), null);
  assert.equal(normaliseRef("ORD-"), null);
  assert.equal(normaliseRef("ORD-TOOLONG1"), null);
  assert.equal(normaliseRef("ORD-SHORT"), null);
  assert.equal(normaliseRef("ORD-7Q4M2!"), null);
  assert.equal(normaliseRef("' OR 1=1 --"), null);
});

test("the ambiguous characters the alphabet excludes are refused", () => {
  // The reference alphabet deliberately omits O/0 and I/1 so it can be read
  // aloud. A reference containing one is a mistranscription, not a lookup.
  assert.equal(normaliseRef("ORD-7Q4M2O"), null);
  assert.equal(normaliseRef("ORD-7Q4M2I"), null);
});
