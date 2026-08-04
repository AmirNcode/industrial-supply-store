import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  doublePrecision,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Spec value as stored in `products.specs`. Numbers stay numbers so the spec
 * table can right-align and sort them without re-parsing.
 */
export type SpecValue = string | number | null;
export type SpecBag = Record<string, SpecValue>;

/** A single quantity-break price row, denormalised onto the product for display. */
export type PriceTier = { minQty: number; priceCents: number };

// ---------------------------------------------------------------------------
// Catalog taxonomy
// ---------------------------------------------------------------------------

/**
 * Adjacency list (`parentId`) plus a materialised `path` so subtree queries are
 * a single indexed prefix scan instead of a recursive CTE. `path` is the slug
 * chain joined by "/", with no leading or trailing slash:
 *   "fastening-joining/fasteners/screws-bolts"
 */
export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "cascade",
    }),
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(0),
    nameEn: text("name_en").notNull(),
    nameFa: text("name_fa").notNull(),
    /** Key into the in-house SVG icon set. */
    icon: text("icon").notNull().default("box"),
    sort: integer("sort").notNull().default(0),
    /** Denormalised count of SKUs in this subtree; filled by the seeder. */
    productCount: integer("product_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("categories_path_key").on(t.path),
    index("categories_parent_idx").on(t.parentId, t.sort),
    index("categories_depth_idx").on(t.depth),
  ],
);

/**
 * A product family is one heading in the spec table view — "Oil-Resistant
 * Buna-N O-Rings". It always hangs off a leaf category and owns its own spec
 * column definitions.
 */
export const productFamilies = pgTable(
  "product_families",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    nameEn: text("name_en").notNull(),
    nameFa: text("name_fa").notNull(),
    /** Short line under the family name on category cards. */
    descEn: text("desc_en").notNull().default(""),
    descFa: text("desc_fa").notNull().default(""),
    /** Long body of the yellow "About" callout on the family page. */
    aboutEn: text("about_en").notNull().default(""),
    aboutFa: text("about_fa").notNull().default(""),
    icon: text("icon").notNull().default("box"),
    sort: integer("sort").notNull().default(0),
    productCount: integer("product_count").notNull().default(0),
    /** Grouping heading above a run of family cards, e.g. "Oil-Resistant O-Rings". */
    groupEn: text("group_en").notNull().default(""),
    groupFa: text("group_fa").notNull().default(""),
  },
  (t) => [
    uniqueIndex("families_slug_key").on(t.slug),
    index("families_category_idx").on(t.categoryId, t.sort),
  ],
);

/**
 * Declares the spec table columns for one family: which jsonb keys render, in
 * what order, with what label and unit, and whether they get a facet.
 * The spec table is entirely data-driven off this table — adding a new product
 * category requires no UI code.
 */
export const specDefs = pgTable(
  "spec_defs",
  {
    id: serial("id").primaryKey(),
    familyId: integer("family_id")
      .notNull()
      .references(() => productFamilies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    labelEn: text("label_en").notNull(),
    labelFa: text("label_fa").notNull(),
    /** Rendered after the value, e.g. `"` or `mm`. Empty for unitless. */
    unit: text("unit").notNull().default(""),
    /** "number" right-aligns and enables numeric facet sorting; "text" does not. */
    kind: text("kind", { enum: ["number", "text"] }).notNull().default("text"),
    filterable: boolean("filterable").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    uniqueIndex("spec_defs_family_key").on(t.familyId, t.key),
    index("spec_defs_family_sort_idx").on(t.familyId, t.sort),
  ],
);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    partNumber: text("part_number").notNull(),
    familyId: integer("family_id")
      .notNull()
      .references(() => productFamilies.id, { onDelete: "cascade" }),
    /** Display + detail source of truth. Faceting reads productSpecValues instead. */
    specs: jsonb("specs").$type<SpecBag>().notNull().default({}),
    /** Unit price at qty 1, in USD cents. Persian prices convert at render time. */
    priceCents: integer("price_cents").notNull(),
    priceTiers: jsonb("price_tiers").$type<PriceTier[]>().notNull().default([]),
    /** Items ship in packs; qty in the table means "packs", as on the reference site. */
    packQty: integer("pack_qty").notNull().default(1),
    leadDays: integer("lead_days").notNull().default(0),
    inStock: boolean("in_stock").notNull().default(true),
    /** Flattened part number + family + spec values, fed to the FTS index. */
    searchText: text("search_text").notNull().default(""),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    uniqueIndex("products_part_number_key").on(t.partNumber),
    index("products_family_sort_idx").on(t.familyId, t.sort),
  ],
);

/**
 * Denormalised facet index. Exists purely so filter and facet-count queries hit
 * a btree instead of unnesting `products.specs`. Written by the seeder in the
 * same transaction as the product, so it cannot drift.
 */
export const productSpecValues = pgTable(
  "product_spec_values",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    familyId: integer("family_id")
      .notNull()
      .references(() => productFamilies.id, { onDelete: "cascade" }),
    specKey: text("spec_key").notNull(),
    /** Always populated — the display string, and what filters match on. */
    valText: text("val_text").notNull(),
    /** Populated only for numeric specs, so ranges and sorting work. */
    valNum: doublePrecision("val_num"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.specKey] }),
    // Drives both "which products match this filter" and facet counts.
    index("psv_family_key_text_idx").on(t.familyId, t.specKey, t.valText),
    index("psv_family_key_num_idx").on(t.familyId, t.specKey, t.valNum),
  ],
);

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/** Anonymous cart keyed by an httpOnly cookie. No account required in v1. */
export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(1),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cartId, t.productId] })],
);

// ---------------------------------------------------------------------------
// Orders — one row per customer request, from arrival through to delivery
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    /** Human-facing reference, e.g. ORD-7Q4M2X. Read aloud on the phone. */
    ref: text("ref").notNull(),
    /** Null for a guest checkout, which stays supported. */
    userId: uuid("user_id"),
    /** See lib/orders.ts. A CHECK constraint mirrors this in the database. */
    status: text("status").notNull().default("received"),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    poNumber: text("po_number").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default(""),
    notes: text("notes").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    currency: text("currency").notNull().default("USD"),
    /** Total at the catalog prices the customer saw when they submitted. */
    requestedTotalCents: integer("requested_total_cents").notNull().default(0),
    /** Total at the prices staff finally set. Equal until the order is priced. */
    totalCents: integer("total_cents").notNull().default(0),
    paymentUrl: text("payment_url").notNull().default(""),
    courier: text("courier").notNull().default(""),
    trackingNumber: text("tracking_number").notNull().default(""),
    invoiceNumber: text("invoice_number"),
    /**
     * Toman per USD, frozen when the invoice is issued. Without this, editing
     * the rate would restate the amount owed on invoices already emailed.
     */
    fxRateToToman: integer("fx_rate_to_toman"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_ref_key").on(t.ref),
    index("orders_created_idx").on(t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_user_idx").on(t.userId, t.createdAt),
    // Mirrors ORDER_STATUSES in lib/orders.ts. Declared here (rather than left
    // implicit) so `db:push` cannot silently drop it — status is otherwise a
    // free-text column, and this is the only thing stopping a bad write from
    // putting an order in a state `nextStatuses()`/`assertTransition` don't
    // recognise.
    check(
      "orders_status_check",
      sql`${t.status} IN ('received','invoiced','preparing','shipped','delivered','cancelled')`,
    ),
  ],
);

/**
 * Line items snapshot part number, name and specs at submission time so a later
 * catalog edit cannot silently rewrite an order that was already invoiced.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    partNumber: text("part_number").notNull(),
    familyName: text("family_name").notNull().default(""),
    specsSnapshot: jsonb("specs_snapshot").$type<SpecBag>().notNull().default({}),
    qty: integer("qty").notNull(),
    /** What the catalog charged at submission. Never edited. */
    requestedUnitPriceCents: integer("requested_unit_price_cents").notNull().default(0),
    /** What staff finally quoted. */
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Key/value rather than one row with a column per setting, so the next setting
 * is an insert instead of a migration. Values are text and parsed at the edge;
 * there are two of them and both are small.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Customer accounts
// ---------------------------------------------------------------------------

/**
 * One table. Sessions are a signed cookie (see lib/sessionToken.ts), so there
 * is no companion sessions table to sweep.
 *
 * Email uniqueness is enforced by a `lower(email)` index in extensions.sql
 * rather than a plain unique constraint: addresses are case-insensitive in
 * practice, and two rows differing only in capitalisation are two people who
 * both believe they own the account.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    company: text("company").notNull().default(""),
    contactName: text("contact_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    defaultPoNumber: text("default_po_number").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [index("users_created_idx").on(t.createdAt)],
);
