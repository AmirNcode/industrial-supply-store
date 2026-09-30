import "server-only";
import { persianYearMonth } from "./persianCalendar";
import { summarizeRepSales, type RepSummary } from "./repStats";
import { listDeliveredForRep, listPayouts, listTargets, type Payout } from "@/db/repMoney";
import { countCustomersForRep } from "@/db/customerQueries";

/**
 * Everything the rep's home and commission pages show, from four reads, and
 * the payout list it read along the way — the commission views print it, and
 * reading it a second time was a wasted round trip (review L-22). The
 * delivered orders are read once and placed in Persian months here, because
 * Postgres has no Persian calendar; the cost therefore grows with the rep's
 * delivered orders, at a few dozen bytes each.
 */
export async function loadRepSummary(
  repId: string,
  tableYear?: number,
  now: Date = new Date(),
): Promise<{ summary: RepSummary; payouts: Payout[] }> {
  const [delivered, customerCount, payouts, targets] = await Promise.all([
    listDeliveredForRep(repId),
    countCustomersForRep(repId),
    listPayouts(repId),
    listTargets(repId),
  ]);
  const current = persianYearMonth(now);
  const summary = summarizeRepSales({
    sales: delivered.map((row) => ({
      ym: persianYearMonth(row.deliveredAt),
      customerKey: row.customerKey,
      company: row.company,
      salesRial: row.salesRial,
      commissionRial: row.commissionRial,
    })),
    customerCount,
    // A voided payout stays on the list but was never paid.
    paidRial: payouts.reduce((sum, payout) => sum + (payout.voidedAt ? 0 : payout.amountRial), 0),
    targets,
    current,
    tableYear: tableYear ?? current.year,
  });
  return { summary, payouts };
}
