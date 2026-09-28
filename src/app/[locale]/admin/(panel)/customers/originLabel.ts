import type { Dict } from "@/lib/i18n";
import type { CustomerOrigin } from "@/db/customerQueries";

/** How the customer came to have an account, named after the rep involved. */
export function originLabel(t: Dict, origin: CustomerOrigin, originRepName: string | null): string {
  if (origin === "rep") return t.originRep.replace("{name}", originRepName ?? "—");
  if (origin === "referral") return t.originReferral.replace("{name}", originRepName ?? "—");
  return t.originSelf;
}
