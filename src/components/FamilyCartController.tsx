"use client";

import { useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  addToCart,
  removeFromCart,
  useCartSnapshot,
} from "@/lib/cartClient";
import { formatInt } from "@/lib/money";
import type { Locale } from "@/lib/i18n";

type CartButton = HTMLButtonElement & {
  dataset: DOMStringMap & {
    cartAction?: "add" | "remove" | "step";
    cartStep?: string;
    productId?: string;
  };
};

/**
 * The part of a button whose text says what the press is doing.
 *
 * The ADD control in the order panel is an icon beside a word, so writing "✓"
 * over the whole button would drop the icon and never bring it back — the swap
 * goes to the label span instead. A button that is only a glyph has no such
 * span and is written to directly.
 */
function faceOf(button: HTMLButtonElement): HTMLElement {
  return button.querySelector<HTMLElement>("[data-cart-label]") ?? button;
}

function productIdFrom(button: CartButton): number | null {
  const id = Number(button.dataset.productId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requestedQuantity(button: CartButton): number {
  const input = button
    .closest<HTMLElement>("[data-cart-line]")
    ?.querySelector<HTMLInputElement>("[data-cart-qty-input]");
  return Math.max(1, Math.min(99_999, Number(input?.value) || 1));
}

/**
 * One hydrated controller for the whole family table.
 *
 * The rows remain server-rendered. Click/keyboard delegation replaces one
 * AddToCartRow component per product, and this single cart snapshot replaces
 * one external-store subscription per InCartQty cell.
 */
export function FamilyCartController({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const doneTimers = useRef(new WeakMap<HTMLButtonElement, number>());
  const cart = useCartSnapshot();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    for (const status of root.querySelectorAll<HTMLElement>("[data-cart-status]")) {
      const productId = Number(status.dataset.productId);
      const qty = Number.isSafeInteger(productId) ? (cart.qtys[productId] ?? 0) : 0;
      const empty = status.querySelector<HTMLElement>("[data-cart-empty]");
      const filled = status.querySelector<HTMLElement>("[data-cart-filled]");
      const value = status.querySelector<HTMLElement>("[data-cart-value]");
      const present = qty > 0;

      if (empty) empty.hidden = present;
      if (filled) {
        filled.hidden = !present;
        filled.classList.toggle("in-cart", present);
      }
      if (value) value.textContent = present ? formatInt(qty, locale) : "";
    }

    /*
     * The table's own running total.
     *
     * Rendered empty and hidden on the server: the cart lives in client state,
     * and a server that read it would make this page dynamic and cost the whole
     * catalog its cache. The count is every line in the order, not only lines
     * from this family — "Review order" goes to all of it.
     */
    const footer = root.querySelector<HTMLElement>("[data-cart-total]");
    if (footer) {
      const shown = cart.hydrated && cart.count > 0;
      footer.hidden = !shown;
      const value = footer.querySelector<HTMLElement>("[data-cart-total-value]");
      if (value) value.textContent = shown ? formatInt(cart.count, locale) : "";
    }
  }, [cart, locale]);

  async function add(button: CartButton) {
    const productId = productIdFrom(button);
    if (productId === null || button.disabled) return;

    const line = button.closest<HTMLElement>("[data-cart-line]");
    const input = line?.querySelector<HTMLInputElement>("[data-cart-qty-input]");
    const oldTimer = doneTimers.current.get(button);
    if (oldTimer !== undefined) window.clearTimeout(oldTimer);

    const face = faceOf(button);
    const idle = face.dataset.cartIdle ?? face.textContent ?? "+";
    face.dataset.cartIdle = idle;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    face.textContent = "…";
    let ok = false;
    try {
      ok = await addToCart(productId, requestedQuantity(button));
    } catch {
      // Offline/server failure: restore the control and keep the cart snapshot.
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");

    if (!ok) {
      face.textContent = idle;
      return;
    }

    // The field is a committed quantity with a stepper on either side, not the
    // grid's old blank "how many more", so it returns to 1 rather than empty.
    if (input) input.value = "1";
    face.textContent = "✓";
    const timer = window.setTimeout(() => {
      if (button.isConnected && !button.disabled) face.textContent = idle;
      doneTimers.current.delete(button);
    }, 1_600);
    doneTimers.current.set(button, timer);
  }

  /** The order panel's −/+ . Nudges the field without a round trip. */
  function step(button: CartButton) {
    const input = button
      .closest<HTMLElement>("[data-cart-line]")
      ?.querySelector<HTMLInputElement>("[data-cart-qty-input]");
    if (!input) return;
    const by = Number(button.dataset.cartStep) || 0;
    input.value = String(Math.max(1, Math.min(99_999, (Number(input.value) || 1) + by)));
  }

  async function remove(button: CartButton) {
    const productId = productIdFrom(button);
    if (productId === null || button.disabled) return;

    const badge = button.closest<HTMLElement>("[data-cart-filled]");
    button.disabled = true;
    badge?.setAttribute("data-pending", "true");
    try {
      await removeFromCart(productId);
    } catch {
      // Leave the last confirmed quantity visible when the request fails.
    }
    button.disabled = false;
    badge?.removeAttribute("data-pending");
  }

  function onClick(event: ReactMouseEvent<HTMLDivElement>) {
    const button = (event.target as Element).closest<CartButton>(
      "button[data-cart-action]",
    );
    if (!button || !rootRef.current?.contains(button)) return;
    if (button.dataset.cartAction === "add") void add(button);
    else if (button.dataset.cartAction === "remove") void remove(button);
    else if (button.dataset.cartAction === "step") step(button);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter") return;
    const input = (event.target as Element).closest<HTMLInputElement>(
      "input[data-cart-qty-input]",
    );
    if (!input || !rootRef.current?.contains(input)) return;
    const button = input
      .closest<HTMLElement>("[data-cart-line]")
      ?.querySelector<CartButton>('button[data-cart-action="add"]');
    if (!button) return;
    event.preventDefault();
    void add(button);
  }

  return (
    <div
      ref={rootRef}
      className="table-card"
      data-family-cart-controller
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
