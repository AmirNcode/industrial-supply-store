import assert from "node:assert/strict";
import { test } from "node:test";
import { mailboxKey } from "./mailboxKey";

test("decorated addresses that reach one inbox share one key", () => {
  const key = mailboxKey("buyer@gmail.com");
  assert.equal(mailboxKey(" Buyer@Gmail.com "), key);
  assert.equal(mailboxKey("buyer+orders@gmail.com"), key);
  assert.equal(mailboxKey("b.u.y.e.r@gmail.com"), key);
  assert.equal(mailboxKey("buyer@googlemail.com"), key);
  assert.equal(mailboxKey("buyer@gmail.com."), key);
  assert.equal(mailboxKey("buyer+a+b@gmail.com"), key);
});

test("different inboxes stay apart", () => {
  // Dots mean something outside Gmail.
  assert.notEqual(mailboxKey("a.b@example.com"), mailboxKey("ab@example.com"));
  assert.equal(mailboxKey("a.b+tag@example.com"), "a.b@example.com");
  assert.notEqual(mailboxKey("buyer@gmail.com"), mailboxKey("buyer@example.com"));
  // Not an address: returned as typed, never thrown on.
  assert.equal(mailboxKey("not-an-address"), "not-an-address");
});
