import type { ReactNode } from "react";

/**
 * Keeps a page's contents out of session replays: the recorder
 * (`public/stats/recorder.js`, rrweb) draws an element with the `rr-block`
 * class as an empty box and never reads what is inside it. `contents` keeps
 * the wrapper out of the layout. Used by the layouts of every page that shows
 * a customer's own details — see `src/lib/statsTracker.ts`.
 */
export function ReplayBlocked({ children }: { children: ReactNode }) {
  return <div className="rr-block contents">{children}</div>;
}
