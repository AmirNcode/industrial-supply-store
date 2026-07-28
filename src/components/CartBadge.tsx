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
  return (
    <span className="ms-1 inline-block rounded-sm bg-[var(--color-catalog-green)] px-1.5 py-px text-[11px] text-white align-middle tech">
      {formatInt(count, locale)}
    </span>
  );
}
