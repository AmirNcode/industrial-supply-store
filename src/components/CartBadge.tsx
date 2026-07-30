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
  // Amber fill on the dark masthead — the one place a solid accent block earns
  // its keep, because the cart count is the only number in the chrome.
  return (
    <span className="tech ms-1.5 inline-block rounded-[3px] bg-[var(--color-amber)] px-1.5 py-px align-middle text-[10px] font-semibold text-[var(--color-chrome)]">
      {formatInt(count, locale)}
    </span>
  );
}
