"use client";

import { useTransition } from "react";
import { useCartQty, removeFromCart } from "@/lib/cartClient";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/**
 * What this row already has on order.
 *
 * Before this existed the only feedback for an add was a tick that faded after
 * 1.6 seconds and a number in the masthead — a buyer working down a 100-row
 * table could not tell which sizes they had already taken, and re-added them.
 * The quantity stays on the row instead, with a × to undo a mistaken add
 * without a trip to the cart.
 */
export function InCartQty({
  productId,
  locale,
  /** Cards put the label inline; the table has a column header instead. */
  showLabel = false,
}: {
  productId: number;
  locale: Locale;
  showLabel?: boolean;
}) {
  const t = getDict(locale);
  const qty = useCartQty(productId);
  const [pending, start] = useTransition();

  if (qty <= 0) {
    // A table column needs a placeholder or the cell reads as a rendering gap;
    // a card has no column to keep aligned, so it shows nothing at all.
    return showLabel ? null : <span className="text-[var(--color-ink-faint)]">—</span>;
  }

  return (
    <span className="in-cart" data-pending={pending || undefined}>
      {showLabel && <span className="in-cart-label">{t.inCart}</span>}
      <span className="tech font-semibold">{formatInt(qty, locale)}</span>
      <button
        type="button"
        onClick={() => start(async () => void (await removeFromCart(productId)))}
        disabled={pending}
        className="in-cart-x"
        aria-label={t.remove}
        title={t.remove}
      >
        ×
      </button>
    </span>
  );
}
