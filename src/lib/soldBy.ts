/**
 * How a product family is sold. A 'package' family prices a pack and shows
 * its quantity; a 'unit' family prices each item and has no pack column.
 * Stored on `product_families.sold_by`.
 */
export const SOLD_BY = ["package", "unit"] as const;
export type SoldBy = (typeof SOLD_BY)[number];

export function isSoldBy(value: unknown): value is SoldBy {
  return value === "package" || value === "unit";
}

/** The pack size a buyer sees: one for a unit family, whatever was imported otherwise. */
export function displayPackQty(soldBy: SoldBy, packQty: number): number {
  return soldBy === "unit" ? 1 : packQty;
}
