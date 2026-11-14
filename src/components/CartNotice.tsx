"use client";

import { useEffect } from "react";
import { clearCartFailure, useCartFailure, type CartFailure } from "@/lib/cartClient";

/**
 * Says why an add or remove did not happen (review R-12).
 *
 * One notice for the whole page rather than a message per row: the family
 * table's rows are driven by one controller that edits them in place, the
 * cards and the product page by their own components, and all three go through
 * `cartClient`, so the failure is caught once there and shown once here. It is
 * fixed to the bottom edge so it is seen wherever in a long table the buyer is.
 *
 * The wording arrives as props from the layout: importing the dictionary here
 * would ship both languages' full text to every visitor.
 */
export function CartNotice({
  messages,
  dismissLabel,
}: {
  messages: Record<CartFailure["reason"], string>;
  dismissLabel: string;
}) {
  const failure = useCartFailure();

  useEffect(() => {
    if (!failure) return;
    // Long enough to read two lines; a new failure restarts the clock.
    const timer = setTimeout(clearCartFailure, 8000);
    return () => clearTimeout(timer);
  }, [failure]);

  return (
    // The live region stays mounted and empty: a screen reader only announces
    // text that appears inside a region it already knows about.
    <div role="alert" className="no-print fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 pointer-events-none">
      {failure && (
        <div className="pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-[3px] border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[13px] text-[var(--color-danger)] shadow-md">
          <span>{messages[failure.reason]}</span>
          <button
            type="button"
            onClick={clearCartFailure}
            aria-label={dismissLabel}
            title={dismissLabel}
            className="-m-2 shrink-0 p-2 text-[15px] leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
