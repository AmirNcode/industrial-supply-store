import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATS_BEFORE_SEND,
  STATS_BEFORE_SEND_JS,
  statsForwardHeaders,
} from "./statsTracker";

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

test("campaign tags and ad click IDs survive; every other query parameter goes", () => {
  const send = beforeSend();
  assert.equal(
    send("event", { url: "https://www.temex.ir/fa/f/gate-valve?utm_source=instagram&q=x&utm_campaign=yalda#top" })?.url,
    "https://www.temex.ir/fa/f/gate-valve?utm_source=instagram&utm_campaign=yalda",
  );
  assert.equal(send("event", { url: "/en?gclid=abc123" })?.url, "/en?gclid=abc123");
  assert.equal(send("event", { url: "/fa/search?q=valve" })?.url, "/fa/search");
  // A pay link with campaign tags is still reduced to its shape, and its key never kept.
  assert.equal(
    send("event", { url: "/fa/pay/9f8e7d6c5b4a?utm_source=sms&key=secret" })?.url,
    "/fa/pay/[link]?utm_source=sms",
  );
  // Look-alike names are not campaign tags.
  assert.equal(send("event", { url: "/en?utm_sourcex=1&xutm_source=2&utm_source=" })?.url, "/en");
  // The referrer keeps no query string, tags included.
  assert.equal(
    send("event", { url: "/en", referrer: "https://t.me/temex?utm_source=tg" })?.referrer,
    "https://t.me/temex",
  );
});

test("payloads without an address pass through", () => {
  const out = beforeSend()("error", { title: "x" });
  assert.equal(out?.title, "x");
  assert.equal(out?.url, undefined);
});

test("only the allow-listed headers reach the stats server, never cookies", () => {
  const out = statsForwardHeaders(
    new Headers({
      cookie: "isupply_session=secret; admin=secret",
      authorization: "Bearer secret",
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
      "x-forwarded-for": "6.6.6.6",
      "x-umami-cache": "token",
    }),
    "203.0.113.7",
  );
  assert.equal(out.get("cookie"), null);
  assert.equal(out.get("authorization"), null);
  assert.equal(out.get("user-agent"), "Mozilla/5.0");
  assert.equal(out.get("x-umami-cache"), "token");
  // The visitor's address comes from the trusted header, not the one the browser sent.
  assert.equal(out.get("x-forwarded-for"), "203.0.113.7");
  assert.equal(statsForwardHeaders(new Headers(), "unknown").get("x-forwarded-for"), null);
});
