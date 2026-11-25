import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATS_BEFORE_SEND,
  STATS_BEFORE_SEND_JS,
  STATS_RECORDER_LOADER_JS,
  recorderSettings,
  scrubRecorderUpload,
  searchTermForStats,
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

test("recordings lose pay keys and order references, wherever they appear", () => {
  const body = JSON.stringify({
    type: "record",
    payload: {
      website: "w",
      timestamp: 1,
      events: [
        { type: 4, data: { href: "https://www.temex.ir/fa/pay/9f8e7d6c5b4a?placed=1" } },
        { type: 2, data: { node: { attributes: { href: "/en/invoice/ORD-ABC234?key=secret&utm_source=x" } } } },
        { type: "umami:rrweb-event-fragment", data: { value: '{"href":"/fa/account/orders/ORD-XYZ"}' } },
      ],
    },
  });
  const out = scrubRecorderUpload(body);
  assert.ok(out);
  assert.ok(!out.includes("9f8e7d6c5b4a"));
  assert.ok(!out.includes("secret"));
  assert.ok(!out.includes("ORD-ABC234"));
  assert.ok(!out.includes("ORD-XYZ"));
  assert.ok(out.includes("/fa/pay/[link]"));
  assert.ok(out.includes("key=[x]&utm_source=x"));
});

test("heatmap clicks on staff pages are dropped; other uploads are refused", () => {
  const heatmap = (urls: string[]) =>
    JSON.stringify({ type: "heatmap", payload: { website: "w", events: urls.map((url) => ({ type: "click", url })) } });
  assert.equal(scrubRecorderUpload(heatmap(["https://www.temex.ir/fa/admin/orders"])), null);
  const kept = scrubRecorderUpload(heatmap(["https://www.temex.ir/en/rep", "https://www.temex.ir/fa/f/gate-valve"]));
  assert.equal(JSON.parse(kept ?? "{}").payload.events.length, 1);
  assert.equal(scrubRecorderUpload(JSON.stringify({ type: "event", payload: { events: [] } })), null);
  assert.equal(scrubRecorderUpload("not json"), null);
});

test("recorder settings keep known fields and never mask less than form fields", () => {
  assert.deepEqual(recorderSettings({ enabled: true, maskLevel: "none", secret: "x" }), { enabled: true, maskLevel: "moderate" });
  assert.equal(recorderSettings({ maskLevel: "strict" }).maskLevel, "strict");
  assert.deepEqual(recorderSettings(null), { enabled: false });
});

test("the recorder loader runs only on the live site and never on staff pages", () => {
  const run = (hostname: string, pathname: string) => {
    const added: unknown[] = [];
    const document = {
      createElement: () => ({ setAttribute() {} }),
      head: { appendChild: (s: unknown) => added.push(s) },
    };
    new Function("location", "document", STATS_RECORDER_LOADER_JS)({ hostname, pathname }, document);
    return added.length;
  };
  assert.equal(run("www.temex.ir", "/fa/f/gate-valve"), 1);
  assert.equal(run("www.temex.ir", "/fa/admin"), 0);
  assert.equal(run("www.temex.ir", "/en/rep/customers"), 0);
  assert.equal(run("preview.vercel.app", "/fa"), 0);
});

test("search terms keep part numbers but lose personal details and keys", () => {
  assert.equal(searchTermForStats("  6205-2RS Bearing "), "6205-2rs bearing");
  assert.equal(searchTermForStats("abc1234567890"), "abc[number]");
  assert.equal(searchTermForStats("tel09121234567"), "tel[number]");
  assert.equal(searchTermForStats("0912 - 123 - 4567"), "[number]");
  assert.equal(searchTermForStats("(0912) 123.4567"), "[number]");
  assert.equal(searchTermForStats("6037  9918  1234  5678"), "[number]");
  assert.equal(searchTermForStats("skf 6205-2rsh/c3 x123456789"), "skf 6205-2rsh/c3 x123456789");
  assert.equal(searchTermForStats("6205 2rs 12"), "6205 2rs 12");
  assert.equal(searchTermForStats("1234567890"), "[number]");
  assert.equal(searchTermForStats("00989121234567"), "[number]");
  assert.equal(searchTermForStats("912 123 4567"), "[number]");
  assert.equal(searchTermForStats("6037-9918-1234-5678 bearing"), "[number] bearing");
  assert.equal(searchTermForStats("ORD-ABC234"), "[order]");
  assert.equal(searchTermForStats("buyer@example.com valve"), "[email] valve");
  assert.equal(searchTermForStats("09121234567"), "[number]");
  assert.equal(searchTermForStats("۰۹۱۲ ۱۲۳ ۴۵۶۷"), "[number]");
  assert.equal(searchTermForStats("021-88776655"), "[number]");
  assert.equal(searchTermForStats("+98 912 123 4567"), "[number]");
  assert.equal(searchTermForStats("https://www.temex.ir/fa/pay/9f8e7d6c5b4a3f2e1d"), "https://www.temex.ir/fa/pay/[link]");
  assert.equal(searchTermForStats("abcdefghijklmnopqrstuvwxyz0123"), "[token]");
  assert.equal(searchTermForStats("x".repeat(300)).length <= 100, true);
});

test("recordings lose staff addresses and percent-encoded keys too", () => {
  const out = scrubRecorderUpload(
    JSON.stringify({
      type: "record",
      payload: {
        events: [
          { type: 4, data: { href: "https://www.temex.ir/fa/admin/orders/12" } },
          { type: 5, data: { payload: { url: "https://www.temex.ir/en/rep/customers/77" } } },
          { type: 2, data: { href: "https://t.me/share?url=https%3A%2F%2Fwww.temex.ir%2Ffa%2Fpay%2F9f8e7d6c5b4a" } },
          { type: 2, data: { href: "/x?u=%2Fen%2Finvoice%2FORD-ABC234%3Fkey%3Dsecret" } },
        ],
      },
    }),
  );
  assert.ok(out);
  for (const leaked of ["orders/12", "customers/77", "9f8e7d6c5b4a", "ORD-ABC234", "secret"]) {
    assert.ok(!out.includes(leaked), leaked);
  }
  assert.ok(out.includes("/fa/admin/[staff]"));
});
