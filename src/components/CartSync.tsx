"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { refreshCart } from "@/lib/cartClient";

/**
 * Pulls the cart once per navigation, for the whole page.
 *
 * It refetches on every path change rather than only on mount because the cart
 * page edits quantities through Server Actions: without this, walking from the
 * cart back into the catalog would show "In Cart" numbers that were true a
 * screen ago. One small no-store request per navigation buys that correctness.
 */
export function CartSync() {
  const pathname = usePathname();

  useEffect(() => {
    void refreshCart();
  }, [pathname]);

  return null;
}
