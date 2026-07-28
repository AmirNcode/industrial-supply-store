"use client";

import { useState, useTransition } from "react";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * The whole point of the reference site's table: order without leaving the row.
 *
 * This posts to a route handler rather than a Server Action so a single add does
 * not re-render a 200-row table. The header badge is updated by broadcasting an
 * event the badge listens for, which keeps the round trip to one small request.
 */
export function AddToCartRow({
  productId,
  locale,
  packQty,
}: {
  productId: number;
  locale: Locale;
  packQty: number;
}) {
  const t = getDict(locale);
  const [qty, setQty] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function add() {
    const n = Math.max(1, Math.min(99999, Number(qty) || 1));
    start(async () => {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, qty: n }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      window.dispatchEvent(
        new CustomEvent("cart:updated", { detail: { count: data.count } }),
      );
      setQty("");
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    });
  }

  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        aria-label={`${t.qty} — ${packQty > 1 ? `${t.pkg} ${packQty}` : ""}`}
        className="w-11 px-1 py-0.5 text-[11px] text-center"
      />
      <button
        type="button"
        onClick={add}
        disabled={pending}
        className="btn-small"
        aria-label={t.addToOrder}
      >
        {done ? "✓" : pending ? "…" : "+"}
      </button>
    </span>
  );
}
