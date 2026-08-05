-- Applied by the seeder after `drizzle-kit push`.
-- These are expression / extension-backed indexes that drizzle-kit cannot express
-- in the schema DSL, so they live here and are applied idempotently.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Full-text search over the flattened product text.
CREATE INDEX IF NOT EXISTS products_fts_idx
  ON products USING GIN (to_tsvector('simple', search_text));

-- Prefix / fuzzy matching for part-number autocomplete.
CREATE INDEX IF NOT EXISTS products_part_number_trgm_idx
  ON products USING GIN (part_number gin_trgm_ops);

-- Autocomplete over family and category names, both locales.
CREATE INDEX IF NOT EXISTS families_name_en_trgm_idx
  ON product_families USING GIN (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS families_name_fa_trgm_idx
  ON product_families USING GIN (name_fa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS categories_name_en_trgm_idx
  ON categories USING GIN (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS categories_name_fa_trgm_idx
  ON categories USING GIN (name_fa gin_trgm_ops);

-- Subtree scans: WHERE path LIKE 'sealing/%'
-- text_pattern_ops is what makes the LIKE prefix an index range scan.
CREATE INDEX IF NOT EXISTS categories_path_prefix_idx
  ON categories (path text_pattern_ops);

-- Facet counting reads (family_id, spec_key) then groups by value; the composite
-- indexes in schema.ts cover it, but this one covers the "all facets at once"
-- grouping pass without touching the heap.
CREATE INDEX IF NOT EXISTS psv_product_idx
  ON product_spec_values (product_id);

-- ---------------------------------------------------------------------------
-- Order objects drizzle-kit cannot see
-- ---------------------------------------------------------------------------
-- A partial unique index, an expression index and a sequence. None of the
-- three is expressible in Drizzle's schema DSL, so `drizzle-kit push` treats
-- them as drift and drops them on every run — the same way it drops the
-- indexes above. They live here so re-applying this file after a push restores
-- them. invoice_seq in particular is what issues invoice numbers: losing it
-- silently breaks invoicing rather than slowing it down.

-- Invoice numbers are unique, but only once assigned; most orders have none.
CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key
  ON orders (invoice_number) WHERE invoice_number IS NOT NULL;

-- Guest order tracking looks up by reference plus the email it was placed with.
CREATE INDEX IF NOT EXISTS orders_email_ref_idx ON orders (lower(email), ref);

CREATE SEQUENCE IF NOT EXISTS invoice_seq;

-- Email is case-insensitive in practice; two rows differing only in
-- capitalisation are two people who both believe they own the account.
-- createUser relies on this index alone to detect a duplicate, which is why
-- db:push re-applies this file rather than trusting anyone to remember.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Managed Postgres providers expose a REST API over these same tables, reached
-- with a publishable key that ships in browser code. Without RLS, that key
-- reads every order, every customer and every cart directly, bypassing this
-- application entirely.
--
-- The app is unaffected: it connects over raw Postgres as the role that owns
-- these tables, and an owner bypasses RLS. Enabling it with no policies is
-- therefore exactly the intent — deny the REST roles everything, change
-- nothing for the app. Verified by enabling it on a full local copy and
-- exercising reads, writes, search, cart and admin.
--
-- It lives here because `drizzle-kit push` does not model RLS, reads it as
-- drift, and emits `DISABLE ROW LEVEL SECURITY` for every table on every run.
-- Re-applying this file after a push puts it back.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
