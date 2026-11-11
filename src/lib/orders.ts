/**
 * The order lifecycle, in one place.
 *
 * Every transition in the admin page goes through `assertTransition`. Guarding
 * here rather than at each call site is what stops a stale tab, a double
 * submit, or a hand-written form post from moving an order somewhere the
 * business process cannot reach — an order marked shipped without ever being
 * paid for, say.
 */
export const ORDER_STATUSES = [
  "received",
  "quoted",
  "invoiced",
  "payment_review",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Forward one step only. `cancelled` is reachable only while no money has
 * been confirmed. Cancelling a paid order used to be allowed and recorded
 * nothing: no refund, stock left "sold", nothing telling anyone money was owed
 * back (review finding M-10). Until there is a refund flow, a paid order goes
 * forward or is settled off the platform. After shipping, stopping the order
 * is a return, which this version does not model either.
 *
 * `payment_review` is entered only by a receipt upload, and left only by
 * someone confirming the money arrived. There is no way back to `invoiced`:
 * a receipt that does not match is settled by phone, or the order cancelled.
 * `invoiced → preparing` stays for the admin alone, for a payment confirmed
 * without an upload. Reps never confirm (review C-2).
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // `received → invoiced` is the pish-factor issued straight away: at checkout
  // for a cart that is all priced and on the shelf, or by staff accepting on
  // the customer's behalf. `quoted` is staff's prices waiting for the customer.
  received: ["quoted", "invoiced", "cancelled"],
  quoted: ["invoiced", "cancelled"],
  invoiced: ["payment_review", "preparing", "cancelled"],
  payment_review: ["preparing", "cancelled"],
  preparing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function isOrderStatus(v: string): v is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(v);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition: ${from} → ${to}`);
  }
}

/** Unpaid and not cancelled: the order's stock is held for it. */
export const HELD_STATUSES = ["received", "quoted", "invoiced", "payment_review"] as const satisfies readonly OrderStatus[];
/**
 * The same list as a query parameter (`status = ANY(${HELD_STATUS_LIST}::text[])`).
 * Imports, reconcile and the shortfall warning all read it from here, so a
 * new held status cannot leave one of them disagreeing (review L-23).
 */
export const HELD_STATUS_LIST: string[] = [...HELD_STATUSES];

/** A receipt can be added while payment is owed or being checked, and not after. */
export function acceptsPaymentProof(status: OrderStatus): boolean {
  return status === "invoiced" || status === "payment_review";
}

/** How long a pish-factor stays payable. */
export const PISH_FACTOR_TTL_HOURS = 24;
/** How long staff have to quote before held stock is released, and how long a quote stands. */
export const QUOTE_TTL_DAYS = 5;

/** Open and waiting on someone, so it can carry a deadline (`orders.expires_at`). */
export function carriesDeadline(status: OrderStatus): boolean {
  return status === "received" || status === "quoted" || status === "invoiced";
}
