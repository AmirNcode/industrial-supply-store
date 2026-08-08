"use client";

import { useState, useTransition } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { addToCart } from "@/lib/cartClient";

/**
 * The whole point of the reference site's table: order without leaving the row.
 *
 * This posts to a route handler rather than a Server Action so a single add does
 * not re-render a 200-row table. The shared client cart takes the response, so
 * the header badge and this row's "In Cart" quantity both move on one request.
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
      if (!(await addToCart(productId, n))) return;
      setQty("");
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    });
  }

  return (
    // Both controls get the same explicit box. `aspect-square` alone does not
    // work here: a flex item is sized from its content first, so the button
    // collapsed to the width of a "+" glyph however the ratio was declared.
    // One shared size variable is the only version that is actually square and
    // actually matches the field.
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
        className="h-7 w-11 px-1 py-0 text-[11px] text-center"
      />
      <button
        type="button"
        onClick={add}
        disabled={pending}
        className="btn-small flex h-7 w-7 shrink-0 items-center justify-center !p-0 text-[15px] leading-none"
        aria-label={t.addToOrder}
      >
        {done ? "✓" : pending ? "…" : "+"}
      </button>
    </span>
  );
}
