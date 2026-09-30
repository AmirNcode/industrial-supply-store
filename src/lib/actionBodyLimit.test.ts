import { test } from "node:test";
import assert from "node:assert/strict";
import { SMALL_ACTION_BYTES, actionBodyAllowed } from "./actionBodyLimit";

test("anonymous actions get a small body; upload pages keep the large one", () => {
  // Cart, checkout, sign-in: 1 MB, and a declared length is required.
  assert.equal(actionBodyAllowed("/fa/quote", "2048"), true);
  assert.equal(actionBodyAllowed("/fa/quote", String(SMALL_ACTION_BYTES + 1)), false);
  assert.equal(actionBodyAllowed("/en/account/signin", "4400000"), false);
  assert.equal(actionBodyAllowed("/en/cart", null), false);
  assert.equal(actionBodyAllowed("/en/cart", "-1"), false);
  // Pages that upload a receipt or artwork are left to Next's 4.25 MB limit.
  assert.equal(actionBodyAllowed("/fa/pay/" + "a".repeat(64), "4400000"), true);
  assert.equal(actionBodyAllowed("/en/account/orders/ORD-ABC234", "4400000"), true);
  assert.equal(actionBodyAllowed("/en/rep/orders/ORD-ABC234", "4400000"), true);
  assert.equal(actionBodyAllowed("/en/admin/products", "4400000"), true);
  assert.equal(actionBodyAllowed("/en/admin", "4400000"), true);
  // The admin sign-in page is public: it gets the small limit like any form.
  assert.equal(actionBodyAllowed("/en/admin/login", "4400000"), false);
  assert.equal(actionBodyAllowed("/fa/admin/login/", "4400000"), false);
  assert.equal(actionBodyAllowed("/en/admin/login", "2048"), true);
  // Lookalikes do not get the allowance.
  assert.equal(actionBodyAllowed("/en/administrator", "4400000"), false);
  assert.equal(actionBodyAllowed("/en/account/profile", "4400000"), false);
});
