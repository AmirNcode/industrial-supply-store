"use client";

/**
 * Shop events for the visitor statistics (lib/statsTracker.ts). Page views
 * alone cannot say what happened on a page: whether a part went in the cart,
 * what a search turned up, whether a receipt was sent. These name those
 * moments so Umami can build goals and funnels from them.
 *
 * Nothing personal goes in: no names, emails, phone numbers, order
 * references or pay links. The staff filter in `temexStatsBeforeSend` drops
 * events from admin and rep pages like it drops their page views.
 */

export type StatsEventName =
  | "add_to_cart"
  | "remove_from_cart"
  | "quick_order"
  | "search"
  | "order_placed"
  | "quote_accepted"
  | "payment_sent";

export type StatsEventData = Record<string, string | number | boolean>;

type Umami = {
  track: (name: string, data?: StatsEventData) => unknown;
  identify: (id: string, data?: StatsEventData) => unknown;
};

/**
 * The tracker loads after the page becomes interactive, so an event raised
 * while the page hydrates (a search result, an order just placed) can arrive
 * before `window.umami` exists. It waits a few seconds for it rather than
 * losing the event; with the tracker off or blocked it gives up quietly.
 */
function withUmami(run: (umami: Umami) => void, attempts = 20): void {
  if (typeof window === "undefined") return;
  const umami = (window as { umami?: Umami }).umami;
  if (umami) {
    try {
      run(umami);
    } catch {
      /* statistics must never break the page */
    }
    return;
  }
  if (attempts > 0) setTimeout(() => withUmami(run, attempts - 1), 250);
}

export function trackStat(name: StatsEventName, data?: StatsEventData): void {
  withUmami((umami) => umami.track(name, data));
}

/**
 * Ties this visit to a signed-in customer, so returning buyers count as one
 * person in Retention. The account's random ID only, never an email: Umami shows the
 * ID to anyone who can sign in there.
 */
export function identifyStat(customerId: string): void {
  withUmami((umami) => umami.identify(`customer-${customerId}`));
}
