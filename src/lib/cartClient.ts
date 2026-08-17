"use client";

import { useSyncExternalStore } from "react";

/**
 * One client-side copy of the cart, shared by every row on the page.
 *
 * A 100-row spec table renders 100 "In Cart" cells. Each fetching its own
 * quantity would be 100 requests; passing the quantities down from the server
 * would make the catalog dynamic and cost the page its cache (see CartLink).
 * So the cart is fetched once per navigation by CartSync and read from here.
 */

export type CartSnapshot = {
  /** Number of distinct lines, which is what the header badge shows. */
  count: number;
  qtys: Record<number, number>;
  /** False until the first fetch lands, so nothing renders a wrong zero. */
  hydrated: boolean;
};

const serverSnapshot: CartSnapshot = { count: 0, qtys: {}, hydrated: false };
let state: CartSnapshot = serverSnapshot;

const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

type CartResponse = { count?: number; qtys?: Record<string, number> };

/** Replaces the local copy with what the server actually holds. */
export async function refreshCart(): Promise<void> {
  try {
    const res = await fetch("/api/cart", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as CartResponse;
    const qtys: Record<number, number> = {};
    for (const [k, v] of Object.entries(data.qtys ?? {})) qtys[Number(k)] = v;
    state = { count: data.count ?? 0, qtys, hydrated: true };
    emit();
  } catch {
    /* offline — keep showing the last known cart rather than a wrong empty one */
  }
}

/** Applies a single line's new quantity, from an add or a remove. */
function applyLine(productId: number, qty: number, count: number) {
  const qtys = { ...state.qtys };
  if (qty > 0) qtys[productId] = qty;
  else delete qtys[productId];
  state = { count, qtys, hydrated: true };
  emit();
}

export async function addToCart(productId: number, qty: number): Promise<boolean> {
  const res = await fetch("/api/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, qty }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { count: number; qty: number };
  applyLine(productId, data.qty, data.count);
  return true;
}

export async function removeFromCart(productId: number): Promise<boolean> {
  const res = await fetch("/api/cart", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { count: number };
  applyLine(productId, 0, data.count);
  return true;
}

/** Quantity of one product in the cart; 0 when absent or not yet loaded. */
export function useCartQty(productId: number): number {
  return useSyncExternalStore(
    subscribe,
    () => state.qtys[productId] ?? 0,
    // The server cannot know the cart without making the page dynamic, so the
    // first paint is always empty and the real value arrives on hydration.
    () => 0,
  );
}

/** One subscription for a controller that owns many catalog rows. */
export function useCartSnapshot(): CartSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

/** Line count for the header badge; null until the first fetch resolves. */
export function useCartCount(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (state.hydrated ? state.count : null),
    () => null,
  );
}
