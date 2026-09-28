import "server-only";
import { persianYearMonth } from "./persianCalendar";
import { summarizeRepSales, type RepSummary } from "./repStats";
import { listDeliveredForRep, listPayouts, listTargets } from "@/db/repMoney";
import { countCustomersForRep } from "@/db/customerQueries";

/**
 * Everything the rep's home and commission pages show, from four reads. The
 * delivered orders are read once and placed in Persian months here, because
 * Postgres has no Persian calendar; the cost therefore grows with the rep's
 * delivered orders, at a few dozen bytes each.
 */
export async function loadRepSummary(
  repId: string,
  tableYear?: number,
  now: Date = new Date(),
): Promise<RepSummary> {
  const [delivered, customerCount, payouts, targets] = await Promise.all([
    listDeliveredForRep(repId),
    countCustomersForRep(repId),
    listPayouts(repId),
    listTargets(repId),
  ]);
  const current = persianYearMonth(now);
  return summarizeRepSales({
    sales: delivered.map((row) => ({
      ym: persianYearMonth(row.deliveredAt),
      customerKey: row.customerKey,
      company: row.company,
      salesRial: row.salesRial,
      commissionRial: row.commissionRial,
    })),
    customerCount,
    paidRial: payouts.reduce((sum, payout) => sum + payout.amountRial, 0),
    targets,
    current,
    tableYear: tableYear ?? current.year,
  });
}
