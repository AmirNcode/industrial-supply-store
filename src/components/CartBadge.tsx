"use client";

import { useCartCount } from "@/lib/cartClient";
import { formatInt } from "@/lib/money";
import type { Locale } from "@/lib/i18n";

/**
 * Reads the shared client cart rather than the cookie, so the surrounding page
 * stays cached. CartSync keeps that copy current; an add updates it in place,
 * so a 200-row spec table never re-renders just because the badge changed.
 */
export function CartBadge({ locale }: { locale: Locale }) {
  const count = useCartCount();

  if (count === null || count <= 0) return null;
  // The one gold object left in the masthead, and it keeps its place because
  // the cart count is the only number up there — gold means money, and this is
  // how much of it is in the order.
  return (
    <span className="tech ms-1.5 inline-block rounded-[3px] bg-[var(--color-amber)] px-1.5 py-px align-middle text-[10px] font-semibold text-[var(--color-chrome)]">
      {formatInt(count, locale)}
    </span>
  );
}
