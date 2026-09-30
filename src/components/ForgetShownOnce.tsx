"use client";

import { useEffect } from "react";

/** Deletes the shown-once cookie as soon as its credential has rendered. */
export function ForgetShownOnce() {
  useEffect(() => {
    void fetch("/api/shown-once", { method: "DELETE", keepalive: true }).catch(() => {
      // The cookie expires on its own within 30 seconds anyway.
    });
  }, []);
  return null;
}
