import assert from "node:assert/strict";
import { test } from "node:test";
import { STATS_BEFORE_SEND, STATS_BEFORE_SEND_JS } from "./statsTracker";

type Payload = { url?: string; referrer?: string; title?: string };

function beforeSend(): (type: string, p: Payload) => Payload | null {
  const window: Record<string, unknown> = {};
  new Function("window", STATS_BEFORE_SEND_JS)(window);
  return window[STATS_BEFORE_SEND] as (type: string, p: Payload) => Payload | null;
}

test("ordinary catalog pages pass through untouched", () => {
  assert.deepEqual(beforeSend()("event", { url: "/fa/f/gate-valve", referrer: "https://www.google.com/" }), {
    url: "/fa/f/gate-valve",
    referrer: "https://www.google.com/",
  });
});

test("staff pages are not counted", () => {
  const send = beforeSend();
  for (const url of ["/en/admin", "/fa/admin/orders/12", "/fa/rep", "https://www.temex.ir/en/rep/customers"]) {
    assert.equal(send("event", { url }), null, url);
  }
  assert.notEqual(send("event", { url: "/fa/f/repair-kits" }), null);
});

test("keys and order references are reduced to the page's shape", () => {
  const send = beforeSend();
  assert.equal(send("event", { url: "/fa/pay/9f8e7d6c5b4a" })?.url, "/fa/pay/[link]");
  assert.equal(send("event", { url: "/en/invoice/ORD-ABC234?key=secret" })?.url, "/en/invoice/[order]");
  assert.equal(send("event", { url: "/fa/account/orders/ORD-ABC234" })?.url, "/fa/account/orders/[order]");
  assert.equal(
    send("event", { url: "/fa/f/x", referrer: "https://www.temex.ir/fa/pay/abc?x=1" })?.referrer,
    "https://www.temex.ir/fa/pay/[link]",
  );
});
