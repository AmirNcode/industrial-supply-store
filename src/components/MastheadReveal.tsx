"use client";

import { useEffect, useRef } from "react";

/**
 * Tucks the masthead away on a downward scroll and brings it back on an upward
 * one. Phones only — the positioning lives behind a max-width query in
 * globals.css, so on desktop the attribute is set and nothing reads it.
 *
 * A spec table runs to a couple of hundred rows, and reaching the search or the
 * order from halfway down meant scrolling all the way back to the top. Making
 * the bar permanently sticky would have been simpler, but it spends ~90px of a
 * phone screen on chrome for the whole scroll; this spends it only when the
 * gesture says the user is looking for navigation.
 *
 * Renders nothing and toggles an attribute on the `<header>` above it rather
 * than wrapping it. Wrapping was the first attempt and it broke the build: the
 * masthead contains `SearchBar`, which calls `useSearchParams()`, and putting a
 * client component above that pulls the bailout up to the page root, where
 * Next then demands a Suspense boundary. Keeping the boundary down here leaves
 * the whole masthead server-rendered, and means a scroll never re-renders it.
 */
export function MastheadReveal() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = anchor.current?.closest("header");
    if (!header) return;

    let lastY = window.scrollY;
    let ticking = false;

    const apply = (hidden: boolean) => {
      if (hidden) header.setAttribute("data-hidden", "true");
      else header.removeAttribute("data-hidden");
    };

    const read = () => {
      ticking = false;

      // An open drawer hangs off the bottom of this bar. Tucking the bar away
      // would take the drawer with it, so while the menu is up the header stays
      // put — and stays free of a `transform`, which would otherwise become the
      // containing block for the drawer's fixed backdrop.
      if (header.hasAttribute("data-menu-open")) return;

      const y = window.scrollY;

      // iOS rubber-banding runs scrollY past both ends of the document. The
      // readings on the way back are the bounce unwinding, not a gesture, and
      // acting on them flips the bar as the user lets go.
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (y < 0 || y > max) return;

      const delta = y - lastY;

      // Below this a scroll is thumb tremor rather than intent. `lastY` is
      // deliberately not updated here, so a slow drag still accumulates to a
      // decision rather than being swallowed a pixel at a time.
      if (Math.abs(delta) < 6) return;

      // Never hide within the first screenful: near the top the bar is in view
      // regardless, and hiding it there just makes a short page twitch.
      apply(delta > 0 && y > 120);
      lastY = y;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(read);
    };

    // Passive: this never calls preventDefault, and saying so keeps it off the
    // critical path of the scroll itself.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      apply(false);
    };
  }, []);

  return <span ref={anchor} hidden />;
}
