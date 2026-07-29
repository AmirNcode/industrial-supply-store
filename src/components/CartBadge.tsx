"use client";

import { useEffect, useState } from "react";
import { formatInt } from "@/lib/money";
import type { Locale } from "@/lib/i18n";

/**
 * Fetches its own count so the surrounding page can stay cached, then keeps
 * itself current from the event AddToCartRow broadcasts — no RSC refresh, so a
 * 200-row spec table never re-renders just because the badge changed.
 */
export function CartBadge({ locale }: { locale: Locale }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cart", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (!cancelled && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {
        /* offline — leave the badge hidden rather than showing a wrong number */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<{ count: number }>).detail;
      if (typeof detail?.count === "number") setCount(detail.count);
    }
    window.addEventListener("cart:updated", onUpdate);
    return () => window.removeEventListener("cart:updated", onUpdate);
  }, []);

  if (count === null || count <= 0) return null;
  // Amber fill on the dark masthead — the one place a solid accent block earns
  // its keep, because the cart count is the only number in the chrome.
  return (
    <span className="tech ms-1.5 inline-block rounded-[3px] bg-[var(--color-amber)] px-1.5 py-px align-middle text-[10px] font-semibold text-[var(--color-chrome)]">
      {formatInt(count, locale)}
    </span>
  );
}
