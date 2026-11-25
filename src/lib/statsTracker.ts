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
