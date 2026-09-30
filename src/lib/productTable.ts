/**
 * The admin product table: which columns it shows, in what order, and how a
 * stored product reads as the text in each cell.
 *
 * Free of imports on purpose. The table in the browser and the save action on
 * the server both use it, so the text someone edits and the value the server
 * compares it with are produced by the same function — and nothing here drags
 * the CSV parser into the browser bundle.
 */

/** One product as the table loads it — the same fields a CSV export carries. */
/**
 * Rows per page of the admin product table — and per request of its JSON
 * route, which serves one page at a time (review M-21).
 */
export const PRODUCT_PAGE_SIZE = 100;

export type ProductRecord = {
  partNumber: string;
  specs: Record<string, unknown>;
  priceCents: number;
  packQty: number;
  leadDays: number;
  inStock: boolean;
  inventoryAvailable: number;
  inventoryOnHold: number;
  inventorySold: number;
  imageUrl: string;
};

/** A family column, in the order the /columns page sets. */
export type ProductTableDef = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
};

/**
 * Editable fields that are not family columns. Held and sold stock are shown
 * but never typed: orders decide them, as they do on import.
 */
export type BuiltinField = "qty" | "price" | "packQty" | "leadDays" | "inStock" | "imageUrl";
export type ReadOnlyField = "onHold" | "sold";

/** A cell's name in an edit: `spec:<column key>` or a built-in field. */
export type CellId = `spec:${string}` | BuiltinField;

export type ProductColumn =
  | { kind: "part" }
  | { kind: "spec"; def: ProductTableDef; id: CellId }
  | { kind: "field"; field: BuiltinField; id: CellId }
  | { kind: "readonly"; field: ReadOnlyField };

export const BUILTIN_FIELDS: readonly BuiltinField[] = [
  "qty", "price", "packQty", "leadDays", "inStock", "imageUrl",
];

/**
 * Part number and the family's first column identify the row — the dash number
 * of an O-ring, the thread of a screw — so they lead. Stock and price follow,
 * because they are what changes week to week. Every other column keeps the
 * order the /columns page sets, and the less-edited built-ins close the row.
 */
export function productTableColumns(defs: readonly ProductTableDef[]): ProductColumn[] {
  const spec = (def: ProductTableDef): ProductColumn => ({ kind: "spec", def, id: `spec:${def.key}` });
  const field = (name: BuiltinField): ProductColumn => ({ kind: "field", field: name, id: name });
  const [first, ...rest] = defs;
  return [
    { kind: "part" },
    ...(first ? [spec(first)] : []),
    field("qty"),
    field("price"),
    ...rest.map(spec),
    field("packQty"),
    field("leadDays"),
    field("inStock"),
    { kind: "readonly", field: "onHold" },
    { kind: "readonly", field: "sold" },
    field("imageUrl"),
  ];
}

/**
 * A spec value as text: the same four-decimal clamp the importer and the seeder
 * write, so a stored 0.06999999999999999 reads as 0.07 and matches its facet.
 */
export function specText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(Number(value.toFixed(4)));
  return String(value);
}

/** What a cell shows, and what its input starts from. */
export function cellText(product: ProductRecord, cell: CellId | ReadOnlyField): string {
  switch (cell) {
    case "qty":
      return String(product.inventoryAvailable);
    case "price":
      return (product.priceCents / 100).toFixed(2);
    case "packQty":
      return String(product.packQty);
    case "leadDays":
      return String(product.leadDays);
    case "inStock":
      return product.inStock ? "yes" : "no";
    case "imageUrl":
      return product.imageUrl;
    case "onHold":
      return String(product.inventoryOnHold);
    case "sold":
      return String(product.inventorySold);
    default:
      return specText(product.specs[cell.slice("spec:".length)]);
  }
}

/**
 * A product as it stood when the table loaded it. The save compares this with
 * the database again, so an edit never lands on top of values an import, an
 * order or another tab changed in the meantime — held and sold stock included,
 * since a new order moves stock between them.
 */
export function productFingerprint(product: ProductRecord): string {
  const specs = Object.keys(product.specs)
    .sort()
    .map((key) => [key, specText(product.specs[key])]);
  return JSON.stringify([
    specs,
    product.priceCents,
    product.packQty,
    product.leadDays,
    product.inStock,
    product.inventoryAvailable,
    product.inventoryOnHold,
    product.inventorySold,
    product.imageUrl,
  ]);
}
