import type { ReactNode } from "react";
import { ReplayBlocked } from "@/components/ReplayBlocked";
import { StatsStaffTag } from "@/components/StatsEvent";

/**
 * Staff tools: never in session replays, and the visit is tagged as staff
 * (StatsStaffTag) so its catalog and cart activity can be told apart.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <StatsStaffTag />
      <ReplayBlocked>{children}</ReplayBlocked>
    </>
  );
}
