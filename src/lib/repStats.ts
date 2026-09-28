import type { PersianYearMonth } from "./persianCalendar";

/**
 * A rep's numbers, from their delivered orders.
 *
 * Pure arithmetic over rows the database already priced: each row carries its
 * exact rial sales and commission (db/repMoney.ts) and the Persian month it
 * was delivered in (lib/persianCalendar.ts). Summing whole rial below 2^53 is
 * exact in JavaScript; only the multiplication that produced them was not,
 * and that stayed in Postgres.
 */
export type SaleRow = {
  ym: PersianYearMonth;
  customerKey: string;
  company: string;
  salesRial: number;
  commissionRial: number;
};

export type TargetRow = { year: number; month: number; amountRial: number };

export type MonthLine = {
  month: number;
  salesRial: number;
  saleCount: number;
  commissionRial: number;
  targetRial: number | null;
  percentOfTarget: number | null;
};

export type YearLine = { year: number; salesRial: number; saleCount: number; commissionRial: number };

export type CustomerTotal = { customerKey: string; company: string; salesRial: number };

export type RepSummary = {
  salesToDate: number;
  salesThisMonth: number;
  salesThisYear: number;
  customerCount: number;
  buyingCustomers: number;
  averagePerBuyingCustomer: number | null;
  earnedRial: number;
  paidRial: number;
  owedRial: number;
  targetThisMonth: number | null;
  percentOfTargetThisMonth: number | null;
  tableYear: number;
  months: MonthLine[];
  years: YearLine[];
  availableYears: number[];
  topCustomers: CustomerTotal[];
  earnedByMonth: { ym: PersianYearMonth; salesRial: number; commissionRial: number }[];
};

function compareYm(a: PersianYearMonth, b: PersianYearMonth): number {
  return a.year - b.year || a.month - b.month;
}

/** The target for a month: the latest one set at or before it; null when none ever was. */
export function targetFor(targets: readonly TargetRow[], ym: PersianYearMonth): number | null {
  let best: TargetRow | null = null;
  for (const target of targets) {
    if (compareYm(target, ym) <= 0 && (best === null || compareYm(target, best) > 0)) best = target;
  }
  return best?.amountRial ?? null;
}

function percent(sales: number, target: number | null): number | null {
  return target !== null && target > 0 ? Math.round((sales / target) * 100) : null;
}

export function summarizeRepSales(input: {
  sales: readonly SaleRow[];
  /** Customers currently assigned, whether or not they have bought. */
  customerCount: number;
  paidRial: number;
  targets: readonly TargetRow[];
  current: PersianYearMonth;
  tableYear: number;
}): RepSummary {
  const { sales, targets, current, tableYear } = input;
  let salesToDate = 0;
  let salesThisMonth = 0;
  let salesThisYear = 0;
  let earnedRial = 0;
  const months: MonthLine[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, salesRial: 0, saleCount: 0, commissionRial: 0, targetRial: null, percentOfTarget: null,
  }));
  const years = new Map<number, YearLine>();
  const byMonth = new Map<string, { ym: PersianYearMonth; salesRial: number; commissionRial: number }>();
  const customers = new Map<string, CustomerTotal>();

  for (const sale of sales) {
    salesToDate += sale.salesRial;
    earnedRial += sale.commissionRial;
    if (sale.ym.year === current.year) {
      salesThisYear += sale.salesRial;
      if (sale.ym.month === current.month) salesThisMonth += sale.salesRial;
    }
    if (sale.ym.year === tableYear) {
      const line = months[sale.ym.month - 1];
      line.salesRial += sale.salesRial;
      line.saleCount += 1;
      line.commissionRial += sale.commissionRial;
    }
    const year = years.get(sale.ym.year) ?? { year: sale.ym.year, salesRial: 0, saleCount: 0, commissionRial: 0 };
    year.salesRial += sale.salesRial;
    year.saleCount += 1;
    year.commissionRial += sale.commissionRial;
    years.set(sale.ym.year, year);

    const key = `${sale.ym.year}-${sale.ym.month}`;
    const month = byMonth.get(key) ?? { ym: sale.ym, salesRial: 0, commissionRial: 0 };
    month.salesRial += sale.salesRial;
    month.commissionRial += sale.commissionRial;
    byMonth.set(key, month);

    const customer = customers.get(sale.customerKey) ?? {
      customerKey: sale.customerKey, company: sale.company, salesRial: 0,
    };
    customer.salesRial += sale.salesRial;
    customers.set(sale.customerKey, customer);
  }

  // A month still to come has no target to measure against yet.
  for (const line of months) {
    const ym = { year: tableYear, month: line.month };
    if (compareYm(ym, current) > 0) continue;
    line.targetRial = targetFor(targets, ym);
    line.percentOfTarget = percent(line.salesRial, line.targetRial);
  }

  const targetThisMonth = targetFor(targets, current);
  const buyingCustomers = customers.size;
  return {
    salesToDate,
    salesThisMonth,
    salesThisYear,
    customerCount: input.customerCount,
    buyingCustomers,
    averagePerBuyingCustomer: buyingCustomers > 0 ? Math.round(salesToDate / buyingCustomers) : null,
    earnedRial,
    paidRial: input.paidRial,
    owedRial: earnedRial - input.paidRial,
    targetThisMonth,
    percentOfTargetThisMonth: percent(salesThisMonth, targetThisMonth),
    tableYear,
    months,
    years: [...years.values()].sort((a, b) => b.year - a.year),
    availableYears: [...new Set([current.year, ...years.keys()])].sort((a, b) => b - a),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.salesRial - a.salesRial || a.company.localeCompare(b.company))
      .slice(0, 5),
    earnedByMonth: [...byMonth.values()].sort((a, b) => compareYm(b.ym, a.ym)),
  };
}
