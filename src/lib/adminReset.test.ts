import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The order queue cannot reset an account the order does not belong to.
 *
 * It used to offer "Reset password" on any order whose *typed* email matched
 * an account, and resolved the account from that address. Anyone can type
 * anyone's email on a guest order, so one phone call to staff handed over the
 * owner's account (review finding H-11). The queue now links to the account
 * that placed the order, by its id, and resets happen on the customer's page.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("the order queue offers no password reset and resolves no account from an email", () => {
  const queue = read("src/app/[locale]/admin/(panel)/orders/page.tsx");
  const actions = read("src/app/[locale]/admin/actions.ts");
  assert.ok(!/resetCustomerPassword|setPassword/.test(queue), "the queue resets passwords");
  assert.ok(!/setPassword|resetCustomerPassword|lower\(email\)/.test(actions), "an order action resets by email");
  assert.match(queue, /admin\/customers\/\$\{q\.userId\}/, "the queue links the order's own account");
});
