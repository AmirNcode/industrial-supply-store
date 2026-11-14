/**
 * The cart cookie itself is httpOnly, so the browser's own code cannot tell
 * whether a visitor has a cart. This second cookie says only that one exists:
 * it carries no id and opens nothing, so it is safe to be readable. `CartSync`
 * checks it and skips the cart request for the visitors who have never added
 * anything — most people and every crawler that runs scripts, each of which
 * used to cost one function call per page view (review R-10).
 */
export const CART_MARKER_COOKIE = "isupply_has_cart";

/** True when a `document.cookie` string carries the marker. */
export function hasCartMarker(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .some((pair) => pair.trim() === `${CART_MARKER_COOKIE}=1`);
}
