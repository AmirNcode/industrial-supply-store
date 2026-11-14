import assert from "node:assert/strict";
import { test } from "node:test";
import { CART_MARKER_COOKIE, hasCartMarker } from "./cartMarker";

test("the marker is found wherever it sits among other cookies", () => {
  assert.equal(hasCartMarker(`${CART_MARKER_COOKIE}=1`), true);
  assert.equal(hasCartMarker(`a=b; ${CART_MARKER_COOKIE}=1; c=d`), true);
  assert.equal(hasCartMarker(`a=b;${CART_MARKER_COOKIE}=1`), true);
});

test("no marker means no cart request", () => {
  assert.equal(hasCartMarker(""), false);
  assert.equal(hasCartMarker("a=b; c=d"), false);
  // A cookie that merely ends with the name, or holds another value, is not it.
  assert.equal(hasCartMarker(`x${CART_MARKER_COOKIE}=1`), false);
  assert.equal(hasCartMarker(`${CART_MARKER_COOKIE}=0`), false);
  assert.equal(hasCartMarker(`${CART_MARKER_COOKIE}=10`), false);
});
