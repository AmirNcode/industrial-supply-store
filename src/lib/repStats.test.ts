import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRepSales, targetFor, type SaleRow } from "./repStats";

const sale = (year: number, month: number, customerKey: string, salesRial: number): SaleRow => ({
  ym: { year, month },
  customerKey,
  company: `Co ${customerKey}`,
  salesRial,
  commissionRial: Math.round(salesRial * 0.025),
});
const MEHR_1405 = { year: 1405, month: 7 };

test("tiles: to date, this month, this year, customers, average per buying customer, owed", () => {
  const summary = summarizeRepSales({
    sales: [sale(1404, 12, "a", 1000), sale(1405, 1, "a", 2000), sale(1405, 7, "b", 4000), sale(1405, 7, "c", 1000)],
    customerCount: 5,
    paidRial: 100,
    targets: [],
    current: MEHR_1405,
    tableYear: 1405,
  });
  assert.equal(summary.salesToDate, 8000);
  assert.equal(summary.salesThisYear, 7000);
  assert.equal(summary.salesThisMonth, 5000);
  assert.equal(summary.customerCount, 5);
  assert.equal(summary.buyingCustomers, 3);
  assert.equal(summary.averagePerBuyingCustomer, 2667);
  assert.equal(summary.earnedRial, 200);
  assert.equal(summary.owedRial, 100);
});

test("the monthly table is one Persian year; Esfand stays in the year it belongs to", () => {
  const input = {
    sales: [sale(1404, 12, "a", 1000), sale(1405, 1, "a", 2000)],
    customerCount: 1,
    paidRial: 0,
    targets: [],
    current: MEHR_1405,
    tableYear: 1405,
  };
  const thisYear = summarizeRepSales(input);
  assert.equal(thisYear.months.length, 12);
  assert.equal(thisYear.months[0].salesRial, 2000);
  assert.equal(thisYear.months[11].salesRial, 0);
  assert.deepEqual(thisYear.years.map((y) => [y.year, y.salesRial]), [[1405, 2000], [1404, 1000]]);
  assert.deepEqual(thisYear.availableYears, [1405, 1404]);
  assert.equal(summarizeRepSales({ ...input, tableYear: 1404 }).months[11].salesRial, 1000);
});

test("a target stands from the month it is set until a later one replaces it", () => {
  const targets = [
    { year: 1405, month: 3, amountRial: 1000 },
    { year: 1405, month: 6, amountRial: 2000 },
  ];
  assert.equal(targetFor(targets, { year: 1405, month: 2 }), null);
  assert.equal(targetFor(targets, { year: 1405, month: 3 }), 1000);
  assert.equal(targetFor(targets, { year: 1405, month: 5 }), 1000);
  assert.equal(targetFor(targets, { year: 1405, month: 7 }), 2000);
  assert.equal(targetFor(targets, { year: 1406, month: 1 }), 2000);

  const summary = summarizeRepSales({
    sales: [sale(1405, 7, "a", 1500)],
    customerCount: 1,
    paidRial: 0,
    targets,
    current: MEHR_1405,
    tableYear: 1405,
  });
  assert.equal(summary.targetThisMonth, 2000);
  assert.equal(summary.percentOfTargetThisMonth, 75);
  assert.equal(summary.months[3].targetRial, 1000);
  assert.equal(summary.months[7].targetRial, null);
});

test("top customers: five at most, largest first", () => {
  const sales = ["a", "b", "c", "d", "e", "f"].map((key, i) => sale(1405, 1, key, (i + 1) * 100));
  const summary = summarizeRepSales({ sales, customerCount: 6, paidRial: 0, targets: [], current: MEHR_1405, tableYear: 1405 });
  assert.deepEqual(summary.topCustomers.map((c) => c.customerKey), ["f", "e", "d", "c", "b"]);
});

test("no sales: zeros, and no average rather than a division by zero", () => {
  const summary = summarizeRepSales({ sales: [], customerCount: 2, paidRial: 0, targets: [], current: MEHR_1405, tableYear: 1405 });
  assert.equal(summary.salesToDate, 0);
  assert.equal(summary.averagePerBuyingCustomer, null);
  assert.equal(summary.percentOfTargetThisMonth, null);
  assert.deepEqual(summary.availableYears, [1405]);
  assert.deepEqual(summary.earnedByMonth, []);
});
