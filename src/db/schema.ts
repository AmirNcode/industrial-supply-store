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

/**
 * A downloadable attached to a product — datasheet, drawing, certificate.
 *
 * `url` is empty for a document a spreadsheet named but nobody has uploaded
 * yet, which is the state every row imported from a supplier file starts in.
 * The label is still worth keeping: it says the document exists and can be
 * asked for.
 */
export type ProductDocument = { label: string; url: string };

/**
 * Where a spec column appears.
 *
 * A family can hold far more columns than a table can show — the first real
 * gate valve file has 45. `table` columns identify a product while scanning a
 * list; `detail` columns describe it once it is the product you care about, and
 * render only in the expanded row.
 */
export type SpecDisplay = "table" | "detail";

/**
 * How one uploaded CSV header maps onto something that is not a spec: a
 * built-in product field, or nothing at all.
 *
 * Stored per family so the second upload of the same supplier's file has
 * nothing left to confirm. `"__ignore__"` is a decision, not an absence — it is
 * what stops a column someone deliberately dropped from being re-proposed as
 * new on every subsequent upload.
 */
export const IGNORED_FIELD = "__ignore__";
export type FieldAliases = Record<string, string>;

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
    /** Optional catalog artwork. The SVG icon remains the empty-state fallback. */
    imageUrl: text("image_url").notNull().default(""),
    /**
     * Long body of the callout above the category listing, in both views.
     * Persian is optional: an empty `aboutFa` renders `aboutEn`, because a
     * blank callout serves a Persian reader worse than an English paragraph.
     */
    aboutEn: text("about_en").notNull().default(""),
    aboutFa: text("about_fa").notNull().default(""),
    /**
     * Second image slot, for a labelled dimension diagram beside the
     * description. Separate from `imageUrl` because the two are not
     * interchangeable — one identifies the products, the other explains what
     * their measurements mean. Falls back to `imageUrl` at thumbnail size.
     */
    diagramUrl: text("diagram_url").notNull().default(""),
    /** Hidden categories also hide their complete descendant subtree publicly. */
    isVisible: boolean("is_visible").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    /** Denormalised count of SKUs in this subtree; filled by the seeder. */
    productCount: integer("product_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("categories_path_key").on(t.path),
    index("categories_parent_idx").on(t.parentId, t.sort),
    index("categories_depth_idx").on(t.depth),
    check("categories_depth_check", sql`${t.depth} >= 0`),
    check("categories_product_count_check", sql`${t.productCount} >= 0`),
  ],
);

/**
 * A product family is one heading in the spec table view — "Oil-Resistant
 * Buna-N O-Rings". It hangs off a category at any depth, provided that category
 * has no subcategories, and owns its own spec column definitions.
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
    /** Optional family artwork shown anywhere the generic icon used to appear. */
    imageUrl: text("image_url").notNull().default(""),
    /** See `categories.diagramUrl`. Same slot, same fallback. */
    diagramUrl: text("diagram_url").notNull().default(""),
    /** Admin-controlled catalog visibility; products and search inherit it. */
    isVisible: boolean("is_visible").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    productCount: integer("product_count").notNull().default(0),
    /** Grouping heading above a run of family cards, e.g. "Oil-Resistant O-Rings". */
    groupEn: text("group_en").notNull().default(""),
    groupFa: text("group_fa").notNull().default(""),
    /**
     * Remembered CSV header decisions that are not spec columns — a header
     * mapped onto a built-in field, or one marked ignored. Spec columns
     * remember their own header in `spec_defs.csv_alias` instead, because they
     * are rows that can be deleted and the memory should go with them.
     */
    fieldAliases: jsonb("field_aliases").$type<FieldAliases>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("families_slug_key").on(t.slug),
    index("families_category_idx").on(t.categoryId, t.sort),
    check("product_families_product_count_check", sql`${t.productCount} >= 0`),
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
    /**
     * Superseded by `inTable`/`inDetail` on 2026-08-20 and no longer read.
     *
     * Kept for one release so a restore is possible without one; a later
     * migration drops it. Its default is what keeps an insert that still names
     * the old column valid.
     */
    display: text("display", { enum: ["table", "detail"] })
      .notNull()
      .default("table"),
    /**
     * Where the column renders, as two independent flags.
     *
     * The enum they replace could say "table" or "detail" but never both and
     * never neither, so there was no way to hide a column: everything taken out
     * of the table was pushed into the expanded row instead. A family may hold
     * far more columns than a table can show — the first gate valve file has 45
     * — and some of them are worth neither place.
     */
    inTable: boolean("in_table").notNull().default(true),
    inDetail: boolean("in_detail").notNull().default(false),
    /**
     * Show this column on the collapsed phone card.
     *
     * Separate from `display` because a phone fits three or four values, not
     * the eight a desktop table carries. Expanding the card still shows
     * everything, exactly as the desktop expanded row does.
     */
    mobile: boolean("mobile").notNull().default(false),
    /**
     * The header this column was last imported under, when it differs from
     * `key`. Set on import so a supplier's spelling is matched automatically
     * the next time rather than proposed as a new column.
     */
    csvAlias: text("csv_alias"),
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
    /**
     * Stock counts, in packs — the same unit as `packQty` and every order line.
     *
     * Deliberately advisory: nothing blocks an order that exceeds
     * `inventoryAvailable`. Pricing and confirmation happen off-platform by
     * phone, so a shortfall is something staff resolve in that conversation;
     * the admin queue flags it rather than refusing the customer.
     *
     * `onHold` rises when an order is received and becomes `sold` when that
     * order is marked paid. Both are therefore derived from the order flow,
     * which is why the importer warns before overwriting them.
     */
    inventoryAvailable: integer("inventory_available").notNull().default(0),
    inventoryOnHold: integer("inventory_on_hold").notNull().default(0),
    inventorySold: integer("inventory_sold").notNull().default(0),
    /** Flattened part number + family + spec values, fed to the FTS index. */
    searchText: text("search_text").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    /**
     * Product photo for the expanded row. Empty until someone uploads one —
     * there is no upload UI yet, and the expanded row renders a placeholder.
     */
    imageUrl: text("image_url").notNull().default(""),
    /**
     * Attached documents. A supplier file names them ("Datasheet", "Drawing")
     * long before the PDFs exist, so entries with an empty `url` are normal and
     * render as unlinked labels.
     */
    documents: jsonb("documents").$type<ProductDocument[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex("products_part_number_key").on(t.partNumber),
    index("products_family_sort_idx").on(t.familyId, t.sort),
    check(
      "products_part_number_check",
      sql`${t.partNumber} = btrim(${t.partNumber}) AND ${t.partNumber} <> ''`,
    ),
    check("products_price_cents_check", sql`${t.priceCents} >= 0`),
    check(
      "products_price_tiers_check",
      sql`jsonb_typeof(${t.priceTiers}) = 'array'
        AND NOT jsonb_path_exists(
          ${t.priceTiers},
          '$[*] ? (@.type() != "object" || !(exists(@.minQty)) || !(exists(@.priceCents)) || @.minQty.type() != "number" || @.priceCents.type() != "number" || @.minQty <= 0 || @.priceCents < 0)'
        )`,
    ),
    check("products_pack_qty_check", sql`${t.packQty} > 0`),
    check("products_lead_days_check", sql`${t.leadDays} >= 0`),
    // Negative available stock represents an advisory shortfall and is valid.
    // Held and sold quantities, however, are cumulative physical quantities.
    check("products_inventory_on_hold_check", sql`${t.inventoryOnHold} >= 0`),
    check("products_inventory_sold_check", sql`${t.inventorySold} >= 0`),
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
  (t) => [
    primaryKey({ columns: [t.cartId, t.productId] }),
    check("cart_items_qty_check", sql`${t.qty} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Orders — one row per customer request, from arrival through to delivery
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    /**
     * One browser submission, enforced by Postgres rather than a disabled
     * button. Nullable only so orders that predate this field remain valid.
     */
    submissionKey: uuid("submission_key"),
    /** Human-facing reference, e.g. ORD-7Q4M2X. Read aloud on the phone. */
    ref: text("ref").notNull(),
    /** Null for a guest checkout, which stays supported. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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
    uniqueIndex("orders_submission_key_key").on(t.submissionKey),
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
    check(
      "orders_totals_check",
      sql`${t.requestedTotalCents} >= 0 AND ${t.totalCents} >= 0`,
    ),
    check(
      "orders_invoice_fields_check",
      sql`(
        ${t.invoiceNumber} IS NULL
        AND ${t.fxRateToToman} IS NULL
        AND ${t.invoicedAt} IS NULL
      ) OR (
        ${t.invoiceNumber} IS NOT NULL
        AND btrim(${t.invoiceNumber}) <> ''
        AND ${t.fxRateToToman} > 0
        AND ${t.invoicedAt} IS NOT NULL
      )`,
    ),
    check(
      "orders_timestamp_chain_check",
      sql`(${t.invoicedAt} IS NULL OR ${t.invoicedAt} >= ${t.createdAt})
        AND (${t.paidAt} IS NULL OR (${t.invoicedAt} IS NOT NULL AND ${t.paidAt} >= ${t.invoicedAt}))
        AND (${t.shippedAt} IS NULL OR (${t.paidAt} IS NOT NULL AND ${t.shippedAt} >= ${t.paidAt}))
        AND (${t.deliveredAt} IS NULL OR (${t.shippedAt} IS NOT NULL AND ${t.deliveredAt} >= ${t.shippedAt}))`,
    ),
    check(
      "orders_status_timestamps_check",
      sql`(${t.status} <> 'received' OR ${t.invoicedAt} IS NULL)
        AND (${t.status} NOT IN ('invoiced','preparing','shipped','delivered') OR ${t.invoicedAt} IS NOT NULL)
        AND (${t.status} NOT IN ('preparing','shipped','delivered') OR ${t.paidAt} IS NOT NULL)
        AND (${t.status} NOT IN ('shipped','delivered') OR ${t.shippedAt} IS NOT NULL)
        AND (${t.status} <> 'delivered' OR ${t.deliveredAt} IS NOT NULL)
        AND (${t.status} <> 'invoiced' OR ${t.paidAt} IS NULL)
        AND (${t.status} <> 'preparing' OR ${t.shippedAt} IS NULL)
        AND (${t.status} <> 'shipped' OR ${t.deliveredAt} IS NULL)
        AND (${t.status} <> 'cancelled' OR (${t.shippedAt} IS NULL AND ${t.deliveredAt} IS NULL))`,
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
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_qty_check", sql`${t.qty} > 0`),
    check(
      "order_items_prices_check",
      sql`${t.requestedUnitPriceCents} >= 0 AND ${t.unitPriceCents} >= 0`,
    ),
  ],
);

/**
 * Internal staff notes on an order. **Never shown to the customer** — not on
 * the account order page, not on the invoice, not in the guest tracking
 * payload. Every query that reads these must be behind the admin gate.
 *
 * Append-only and timestamped rather than one editable notes column: the point
 * of a note is what was known when, and an editable field loses that the first
 * time someone tidies it. It also means two staff writing at once cannot
 * silently overwrite each other.
 *
 * There is no author column because there are no named staff accounts yet —
 * `/admin` is a single shared password. When accounts arrive this table gains
 * an author, and existing rows stay honest by having none.
 */
export const orderComments = pgTable(
  "order_comments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_comments_order_idx").on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Key/value rather than one row with a column per setting, so the next setting
 * is an insert instead of a migration. Values are text, small, and parsed at
 * the edge according to the setting they represent.
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
 * Email uniqueness is a `lower(email)` unique index, and it lives in
 * `extensions.sql` because drizzle-kit does not emit an expression index —
 * asked to, it silently produces a table with only `users_created_idx`.
 *
 * That matters more here than for the search indexes beside it: `createUser`
 * decides "email-taken" solely by catching the unique violation, so without
 * the index duplicate accounts are created silently and which one a person
 * signs into becomes arbitrary. `npm run db:push` therefore re-applies
 * extensions.sql itself rather than leaving it to whoever ran the command.
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

// ---------------------------------------------------------------------------
// Request abuse controls
// ---------------------------------------------------------------------------

/**
 * One fixed-window counter per protected operation and caller identity.
 *
 * The identity is an HMAC of the client address or account id. Raw addresses
 * never enter the database, and one row is reused across windows so normal
 * traffic does not create a row per minute forever. Direct application SQL is
 * the only intended consumer; the migration enables RLS and grants no API
 * policy because these counters must not be readable through Supabase REST.
 */
export const requestRateLimits = pgTable(
  "request_rate_limits",
  {
    scope: text("scope").notNull(),
    identityHash: text("identity_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.identityHash] }),
    index("request_rate_limits_expires_idx").on(t.expiresAt),
    check("request_rate_limits_count_check", sql`${t.requestCount} > 0`),
  ],
);
