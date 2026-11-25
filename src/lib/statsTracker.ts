import { latinDigits } from "./digits";

/**
 * Visitor statistics: self-hosted Umami on the owner's home server
 * (https://stats.datafort.ca), chosen 2026-11-25 over US analytics services,
 * which may refuse or forbid Iranian visitors under sanctions.
 *
 * Visitors' browsers never talk to that server, which keeps ad blockers and
 * Iranian network filtering out of the picture and the home server's address
 * out of the page:
 *
 * - The tracker is a copy in `public/stats/script.js`, not loaded from the
 *   stats server. It runs on every page, admin included; loaded from a laptop
 *   at home, anyone who took over that laptop could run code in the admin.
 *   Upgrading Umami does not change it — copy the new `script.js` over it.
 * - Reports go to `/stats/api/send` here (`app/stats/api/send/route.ts`),
 *   which passes on the body and the headers below — never cookies.
 */
export const STATS_ORIGIN = "https://stats.datafort.ca";

/**
 * The site's ID in Umami (Websites → TEMEX → Edit). Not a secret: it is
 * printed in every page. Empty turns the tracker off entirely.
 */
export const STATS_WEBSITE_ID = "01871d6a-34b9-49a8-a54a-78d443fed2ad";

/** Only the live site reports; previews and local builds stay out of the numbers. */
export const STATS_DOMAINS = "www.temex.ir";

/** The window function Umami calls before sending each event. */
export const STATS_BEFORE_SEND = "temexStatsBeforeSend";

/**
 * Runs in the browser before every event leaves the page.
 *
 * - Staff pages (admin, rep portal) are not counted at all.
 * - Paths that carry a key or an order reference are reduced to their shape:
 *   a pay link is a bearer key, so storing it in the stats database would
 *   hand anyone who can sign in there the ability to pay or view the order.
 * - Query strings are dropped except campaign tags (`utm_*`) and ad click
 *   IDs, which Umami reads from the page address for its Campaigns and
 *   Attribution reports. Everything else goes: invoice keys travel as
 *   `?key=`, and search terms are reported as an event instead. This
 *   replaces `data-exclude-search`, which dropped the campaign tags too.
 *   The referrer keeps no query string at all.
 *
 * A string, not a function, because it is printed into the page as-is;
 * `statsTracker.test.ts` runs it to prove each rule.
 */
export const STATS_BEFORE_SEND_JS = `window.${STATS_BEFORE_SEND} = function (type, payload) {
  var campaign = function (u) {
    var q = u.replace(/#.*$/, "").split("?")[1];
    if (!q) return "";
    var kept = q.split("&").filter(function (p) {
      return /^(utm_(source|medium|campaign|term|content)|gclid|fbclid|msclkid)=[^&]{1,200}$/.test(p);
    });
    return kept.length ? "?" + kept.join("&") : "";
  };
  var shape = function (u) {
    if (typeof u !== "string" || !u) return u;
    return u
      .replace(/[?#].*$/, "")
      .replace(/\\/(en|fa)\\/pay\\/[^/]+/, "/$1/pay/[link]")
      .replace(/\\/(en|fa)\\/invoice\\/[^/]+/, "/$1/invoice/[order]")
      .replace(/\\/(en|fa)\\/account\\/orders\\/[^/]+/, "/$1/account/orders/[order]")
      .replace(/\\/(en|fa)\\/r\\/[^/]+/, "/$1/r/[code]");
  };
  if (/^(https?:\\/\\/[^/]+)?\\/(en|fa)\\/(admin|rep)(\\/|$)/.test(payload.url || "")) return null;
  payload.url = typeof payload.url === "string" && payload.url ? shape(payload.url) + campaign(payload.url) : payload.url;
  payload.referrer = shape(payload.referrer);
  return payload;
};`;

/** A page-view report is a few hundred bytes; anything near this is not one. */
export const STATS_MAX_BODY_BYTES = 16 * 1024;

/**
 * The only request headers passed to the stats server. Cookie and
 * Authorization are absent on purpose: the site's sign-in cookies are sent
 * with every same-site request, the report included.
 *
 * `x-forwarded-for` carries the visitor's own address, read from the
 * platform's trusted header — the stats server places visitors by its first
 * entry (CLIENT_IP_HEADER=x-forwarded-for there).
 */
const STATS_FORWARDED = ["content-type", "user-agent", "accept-language", "x-umami-cache"] as const;

export function statsForwardHeaders(incoming: Pick<Headers, "get">, visitorAddress: string): Headers {
  const out = new Headers();
  for (const name of STATS_FORWARDED) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  if (visitorAddress && visitorAddress !== "unknown") out.set("x-forwarded-for", visitorAddress);
  return out;
}

/**
 * Session replays and heatmaps (Umami's recorder, `public/stats/recorder.js`).
 *
 * The recorder has no before-send hook, so what `temexStatsBeforeSend` does
 * for page views happens here, on the way through `app/stats/api/record`:
 *
 * - Private pages (pay links, invoices, the customer account, checkout,
 *   order tracking, admin, rep portal) are wrapped in `rr-block`
 *   (`ReplayBlocked`), which the recorder draws as an empty box: their
 *   contents never leave the browser. Form fields everywhere are masked by
 *   the recorder itself.
 * - Addresses inside a recording still name those pages, and a pay link is
 *   a bearer key, so every string in a recording is passed through
 *   `scrubStatsString` before it reaches the stats server.
 * - Heatmap clicks on staff pages are dropped; the loader in the layout
 *   does not start the recorder on them in the first place.
 */

/** One recorder upload is at most ~500 KB of rrweb events (a page snapshot). */
export const STATS_MAX_RECORD_BYTES = 600 * 1024;

/** The recorder's settings fields; anything else in the answer is dropped. */
export const STATS_RECORDER_FIELDS = [
  "enabled",
  "replayEnabled",
  "heatmapEnabled",
  "sampleRate",
  "heatmapSampleRate",
  "maskLevel",
  "maxDuration",
  "blockSelector",
] as const;

const STAFF_PATH = /^(https?:\/\/[^/]+)?\/(en|fa)\/(admin|rep)(\/|$|\?|#)/;

/**
 * Reduces keys, order references and staff addresses inside any string to
 * their shape. Addresses are also matched percent-encoded (a link inside
 * another link's query string), since a replay stores attributes as written.
 *
 * Not caught: a key split across two fragments of one oversized replay event
 * (over ~500 KB, a page snapshot). The pages that show keys are blocked
 * (\`ReplayBlocked\`), so no recorded page carries one to split.
 */
export function scrubStatsString(s: string): string {
  return s
    .replace(/%2F(en|fa)%2F(pay|invoice|r)%2F[^%&?#"'\s\\<>]+/gi, "%2F$1%2F$2%2F[x]")
    .replace(/%2F(en|fa)%2Faccount%2Forders%2F[^%&?#"'\s\\<>]+/gi, "%2F$1%2Faccount%2Forders%2F[x]")
    .replace(/%2F(en|fa)%2F(admin|rep)%2F[^&?#"'\s\\<>]+/gi, "%2F$1%2F$2%2F[staff]")
    .replace(/\/(en|fa)\/(admin|rep)\/[^?#"'\s\\<>]+/g, "/$1/$2/[staff]")
    .replace(/\/(en|fa)\/pay\/[^/?#"'\s\\<>]+/g, "/$1/pay/[link]")
    .replace(/\/(en|fa)\/invoice\/[^/?#"'\s\\<>]+/g, "/$1/invoice/[order]")
    .replace(/\/(en|fa)\/account\/orders\/[^/?#"'\s\\<>]+/g, "/$1/account/orders/[order]")
    .replace(/\/(en|fa)\/r\/[^/?#"'\s\\<>]+/g, "/$1/r/[code]")
    .replace(/([?&]|&amp;)key=[^&#"'\s\\<>]*/g, "$1key=[x]")
    .replace(/(%3F|%26)key%3D[^%&#"'\s\\<>]*/gi, "$1key%3D[x]");
}

function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubStatsString(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out;
  }
  return value;
}

/**
 * The recorder upload as it may reach the stats server, or null to drop it.
 * Only the two upload types the recorder sends are accepted.
 */
export function scrubRecorderUpload(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { type, payload } = parsed as { type?: unknown; payload?: { events?: unknown } };
  if ((type !== "record" && type !== "heatmap") || !payload || !Array.isArray(payload.events)) return null;
  let events = payload.events;
  if (type === "heatmap") {
    events = events.filter(
      (e) => !(e && typeof e === "object" && typeof (e as { url?: unknown }).url === "string" && STAFF_PATH.test((e as { url: string }).url)),
    );
    if (events.length === 0) return null;
  }
  return JSON.stringify(scrubDeep({ type, payload: { ...payload, events } }));
}

/** Keeps the known settings and never lets masking drop below form fields. */
export function recorderSettings(upstream: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!upstream || typeof upstream !== "object") return { enabled: false };
  for (const key of STATS_RECORDER_FIELDS) {
    const v = (upstream as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  out.maskLevel = out.maskLevel === "strict" ? "strict" : "moderate";
  return out;
}

/** Started by the layout instead of a plain script tag, so staff pages never record. */
export const STATS_RECORDER_LOADER_JS = `(function () {
  if (${JSON.stringify(STATS_DOMAINS.split(","))}.indexOf(location.hostname) < 0) return;
  if (${STAFF_PATH}.test(location.pathname)) return;
  var s = document.createElement("script");
  s.src = "/stats/recorder.js";
  s.defer = true;
  s.setAttribute("data-website-id", ${JSON.stringify(STATS_WEBSITE_ID)});
  document.head.appendChild(s);
})();`;

/**
 * A search term as it may be stored with the `search` event. People paste
 * whatever they have into a search box — an order reference, a pay link, a
 * phone or card number, their email — and the term is kept for anyone who can sign
 * in to Umami, so those are replaced by what they were. Part numbers (short
 * letters, digits and dashes) pass through: they are the point of the event.
 */
export function searchTermForStats(raw: string): string {
  return scrubStatsString(latinDigits(raw).trim().toLowerCase())
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\b(ord|rfq)-[a-z0-9]+/g, "[order]")
    // Any standalone number of 10 or more digits, separators ignored:
    // phone numbers in every spelling (+98, 0098, 09…, without the 0), bank
    // cards, national IDs. A part number that is nothing but a long number
    // is lost with them; part numbers with letters in them are kept.
    .replace(/(?<![a-z0-9])\+?\d[\d\s-]*\d(?![a-z0-9])/g, (m) =>
      m.replace(/\D/g, "").length >= 10 ? "[number]" : m,
    )
    .replace(/[a-z0-9_-]{24,}/g, "[token]")
    .slice(0, 100);
}

