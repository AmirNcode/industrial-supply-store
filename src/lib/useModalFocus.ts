"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableChildren(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden") &&
      element.getClientRects().length > 0 &&
      element.tabIndex >= 0,
  );
}

/**
 * Gives the app's lightweight overlays the keyboard behavior of a modal dialog.
 *
 * The panels stay in their existing DOM positions so forms, Server Actions and
 * route links keep working normally. This primitive owns only focus: enter the
 * panel, contain Tab/Shift+Tab, close on Escape, and return to the opener.
 */
export function useModalFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  openerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const currentContainer = containerRef.current;
    if (!currentContainer) return;
    const container: HTMLElement = currentContainer;

    const restoreTarget =
      openerRef.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const initialFocusFrame = requestAnimationFrame(() => {
      const target =
        container.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        focusableChildren(container)[0] ??
        container;
      target.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusableChildren(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(initialFocusFrame);
      document.removeEventListener("keydown", onKeyDown);
      if (restoreTarget?.isConnected) {
        queueMicrotask(() => restoreTarget.focus({ preventScroll: true }));
      }
    };
  }, [open, containerRef, openerRef]);
}
