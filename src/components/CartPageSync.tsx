"use client";

import { useEffect } from "react";
import { refreshCart } from "@/lib/cartClient";

/**
 * Keeps the shared client cart in step with the cart page's own edits.
 *
 * `CartSync` refetches once per navigation, which covers every route that
 * reaches the cart by linking to it. The cart page is the exception: Update and
 * Remove are Server Actions, so they change the cart without a path change and
 * the masthead badge kept the count it had on arrival — one line left in the
 * order, still reading two.
 *
 * `revision` is the server-rendered line-up. The action revalidates this page,
 * the new payload arrives with a different revision, and the client copy is
 * refetched to match. Passing the count alone would miss a quantity edit.
 */
export function CartPageSync({ revision }: { revision: string }) {
  useEffect(() => {
    void refreshCart();
  }, [revision]);

  return null;
}
