import type { ReactNode } from "react";
import { ReplayBlocked } from "@/components/ReplayBlocked";

/** Shows a customer's own details or staff tools: never in session replays. */
export default function Layout({ children }: { children: ReactNode }) {
  return <ReplayBlocked>{children}</ReplayBlocked>;
}
