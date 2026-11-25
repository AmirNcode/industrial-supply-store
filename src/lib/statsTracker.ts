/**
 * Visitor statistics: self-hosted Umami on the owner's home server
 * (https://stats.datafort.ca), chosen 2026-11-25 over US analytics services,
 * which may refuse or forbid Iranian visitors under sanctions.
 *
 * Visitors' browsers never talk to that server. The tracker loads from
 * `/stats/script.js` and reports to `/stats/api/send` on this site, and
 * `next.config.ts` forwards both. That keeps ad blockers and Iranian network
 * filtering out of the picture, and keeps the home server's address out of
 * the page.
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
 * - Query strings are already dropped by `data-exclude-search` (invoice keys
 *   travel as `?key=`); this strips them again from the referrer.
 *
 * A string, not a function, because it is printed into the page as-is;
 * `statsTracker.test.ts` runs it to prove each rule.
 */
export const STATS_BEFORE_SEND_JS = `window.${STATS_BEFORE_SEND} = function (type, payload) {
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
  payload.url = shape(payload.url);
  payload.referrer = shape(payload.referrer);
  return payload;
};`;
