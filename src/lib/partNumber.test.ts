import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  encodeVariantOrdinal,
  formatPartNumber,
  isTemexPartNumber,
  variantOrdinalOf,
  MAX_VARIANTS_PER_FAMILY,
} from "./partNumber";

test("encodes the first, last and rollover ordinals", () => {
  assert.equal(encodeVariantOrdinal(1), "A001");
  assert.equal(encodeVariantOrdinal(2), "A002");
  assert.equal(encodeVariantOrdinal(999), "A999");
  assert.equal(encodeVariantOrdinal(1000), "B001");
  assert.equal(encodeVariantOrdinal(1998), "B999");
  assert.equal(encodeVariantOrdinal(1999), "C001");
  assert.equal(encodeVariantOrdinal(MAX_VARIANTS_PER_FAMILY), "Z999");
});

test("never generates I or O", () => {
  for (let ordinal = 1; ordinal <= MAX_VARIANTS_PER_FAMILY; ordinal += 997) {
    const suffix = encodeVariantOrdinal(ordinal);
    assert.ok(!suffix.startsWith("I") && !suffix.startsWith("O"), suffix);
  }
});

test("rejects ordinals outside the family's capacity", () => {
  assert.throws(() => encodeVariantOrdinal(0));
  assert.throws(() => encodeVariantOrdinal(MAX_VARIANTS_PER_FAMILY + 1));
  assert.throws(() => encodeVariantOrdinal(1.5));
});

test("formats a full part number and rejects bad family numbers", () => {
  assert.equal(formatPartNumber(1842, 1), "1842A001");
  assert.equal(formatPartNumber(6813, 8), "6813A008");
  assert.throws(() => formatPartNumber(999, 1));
  assert.throws(() => formatPartNumber(10000, 1));
});

test("recognises its own output and rejects legacy codes", () => {
  assert.equal(isTemexPartNumber("1842A001"), true);
  assert.equal(isTemexPartNumber("1842I001"), false);
  assert.equal(isTemexPartNumber("1842O001"), false);
  assert.equal(isTemexPartNumber("2490T1"), false);
  assert.equal(isTemexPartNumber("1842a001"), false);
  // Never minted: the variant number is 1-based.
  assert.equal(isTemexPartNumber("1842A000"), false);
});

test("reads the ordinal back out of a code it generated", () => {
  for (const ordinal of [1, 2, 999, 1000, 1998, 1999, MAX_VARIANTS_PER_FAMILY]) {
    assert.equal(variantOrdinalOf(formatPartNumber(1842, ordinal)), ordinal);
  }
  assert.equal(variantOrdinalOf("2490T1"), null);
  assert.equal(variantOrdinalOf("1842A000"), null);
});
