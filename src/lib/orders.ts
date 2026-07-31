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
  "invoiced",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Forward one step only. `cancelled` is reachable until the goods are with a
 * courier, after which stopping the order is a return, not a cancellation, and
 * that is a different process this version does not model.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  received: ["invoiced", "cancelled"],
  invoiced: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
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
