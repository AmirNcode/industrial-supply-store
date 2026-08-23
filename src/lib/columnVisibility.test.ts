import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHidden,
  mobileAvailable,
  setInTable,
  type ColumnFlags,
} from "./columnVisibility";

const shown: ColumnFlags = {
  inTable: true,
  inDetail: false,
  mobile: true,
  filterable: true,
};

test("turning the table column off takes mobile and the facet with it", () => {
  assert.deepEqual(setInTable(shown, false), {
    inTable: false,
    inDetail: false,
    mobile: false,
    filterable: false,
  });
});

test("the expanded row is a separate decision and survives", () => {
  const both: ColumnFlags = { ...shown, inDetail: true };
  const off = setInTable(both, false);
  assert.equal(off.inDetail, true);
  // Which is what makes a detail-only column reachable in one click.
  assert.equal(isHidden(off), false);
});

test("turning the table column back on does not restore mobile", () => {
  const off = setInTable(shown, false);
  const on = setInTable(off, true);
  assert.equal(on.inTable, true);
  assert.equal(on.mobile, false);
  assert.equal(on.filterable, false);
});

test("mobile is only answerable while the table shows the column", () => {
  assert.equal(mobileAvailable({ inTable: true }), true);
  assert.equal(mobileAvailable({ inTable: false }), false);
});

test("a column can render nowhere, which the old enum could not express", () => {
  assert.equal(isHidden({ inTable: false, inDetail: false }), true);
  assert.equal(isHidden({ inTable: true, inDetail: false }), false);
  assert.equal(isHidden({ inTable: false, inDetail: true }), false);
  // The state the enum also could not express: both at once.
  assert.equal(isHidden({ inTable: true, inDetail: true }), false);
});

test("the setter does not mutate the flags it was given", () => {
  const original: ColumnFlags = { ...shown };
  setInTable(original, false);
  assert.deepEqual(original, shown);
});
