"use client";

import { useEffect, useRef } from "react";

/**
 * Pins the filter fold and the spec table's head to the top of the window while
 * the reader scrolls back up a long table, and lets both go on the way down.
 * Desktop only — the positioning lives behind a min-width query in globals.css,
 * so on a phone the attribute is set and nothing reads it. The phone keeps the
 * masthead reveal it already had, which is a different bar on a different page.
 *
 * This is `MastheadReveal`'s gesture applied to the table: with a family now
 * rendering all of its rows, "which column is this?" comes up a thousand rows
 * from the heading that answers it. Pinning the head permanently would spend
 * ~90px of every catalog page on chrome even while reading straight down, so it
 * is spent only when the gesture says the reader is looking back.
 *
 * An *open* filter fold is exempt and stays pinned in both directions — that
 * rule is in the stylesheet, not here. It is a panel someone is working in, and
 * un-pinning it returns it to the top of the document, where from a thousand
 * rows down it has simply vanished.
 *
 * Renders nothing and toggles an attribute on the `<section>` above it rather
 * than wrapping it — the same reason `MastheadReveal` does: the fold contains
 * `FacetSidebar`, and a client component wrapping the catalog would pull the
 * whole thing off the server for a scroll listener.
 */
export function CatalogHeadReveal() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const shell = anchor.current?.closest("[data-catalog-head]");
    if (!(shell instanceof HTMLElement)) return;

    let lastY = window.scrollY;
    let ticking = false;

    /*
     * How far down the window the table head pins: the height of the filter
     * fold above it, whatever that currently is.
     *
     * Measured rather than declared as a constant because an open fold is as
     * tall as its facets, and a family can have three of them or thirty. The
     * observer fires on open and close as well as on reflow, so this is also
     * what keeps the head in place while the panel is being used.
     */
    const fold = shell.querySelector(".filter-fold");
    const measure = () => {
      shell.style.setProperty(
        "--catalog-head-top",
        `${fold instanceof HTMLElement ? fold.offsetHeight : 0}px`,
      );
      // Opening the fold grows the page under the reader, and the browser
      // adjusts the scroll offset to keep the view still. That adjustment is
      // not a gesture, so the next real one is measured from where it left us
      // rather than being read as a scroll down that drops the head.
      lastY = window.scrollY;
    };

    measure();
    const sizes = fold ? new ResizeObserver(measure) : null;
    if (fold) sizes!.observe(fold);

    const apply = (hidden: boolean) => {
      if (hidden) shell.setAttribute("data-hidden", "true");
      else shell.removeAttribute("data-hidden");
    };

    const read = () => {
      ticking = false;

      const y = window.scrollY;

      // Rubber-banding runs scrollY past both ends of the document. The
      // readings on the way back are the bounce unwinding, not a gesture.
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (y < 0 || y > max) return;

      const delta = y - lastY;

      // Below this a scroll is tremor rather than intent. `lastY` is
      // deliberately not updated here, so a slow drag still accumulates to a
      // decision rather than being swallowed a pixel at a time.
      if (Math.abs(delta) < 6) return;

      // Never pin within the first screenful: up there the real heading is on
      // screen anyway, and a copy of it landing on top would be a duplicate.
      apply(delta > 0 || y <= 120);
      lastY = y;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(read);
    };

    // Start hidden: nothing is pinned until the reader scrolls back up.
    apply(true);

    // Passive: this never calls preventDefault, and saying so keeps it off the
    // critical path of the scroll itself.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      sizes?.disconnect();
      shell.style.removeProperty("--catalog-head-top");
      apply(false);
    };
  }, []);

  return <span ref={anchor} hidden />;
}
