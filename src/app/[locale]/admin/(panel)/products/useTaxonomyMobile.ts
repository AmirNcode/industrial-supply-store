"use client";

import { useSyncExternalStore } from "react";
import { TAXONOMY_MOBILE_QUERY } from "@/lib/adminTaxonomy";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(TAXONOMY_MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the products page should show the phone flow.
 *
 * The server cannot know the width, so it renders the desktop workbench and a
 * phone swaps to its own flow at hydration. Until then globals.css hides the
 * desktop card at the same width, so a phone never sees the rail flash past,
 * and a desktop gets exactly the markup it got before.
 */
export function useTaxonomyMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(TAXONOMY_MOBILE_QUERY).matches,
    () => false,
  );
}
