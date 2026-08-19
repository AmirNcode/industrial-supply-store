-- Applied by the seeder after `drizzle-kit push`.
-- These are expression / extension-backed indexes that drizzle-kit cannot express
-- in the schema DSL, so they live here and are applied idempotently.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Search text is compared in two forms:
--
--   words:   "Oil-Resistant O-Rings" -> "oilresistant orings"
--   compact: "Oil-Resistant O-Rings" -> "oilresistantorings"
--
-- Punctuation disappears instead of becoming a word boundary so a buyer does
-- not have to know whether the catalog spells a term as "O-ring", "O ring" or
-- "oring". Spaces remain in the words form so a match at the start of a real
-- word can outrank an incidental substring such as "oring" in "flooring".
--
-- The normalizer uses only immutable built-ins so PostgreSQL can safely use it
-- in the normalized product expression index below. Persian letters are left
-- intact; only punctuation and spacing are changed.
CREATE OR REPLACE FUNCTION catalog_search_words(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        lower(coalesce(input, '')),
        '[[:punct:]®™©]+',
        '',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$function$;

CREATE OR REPLACE FUNCTION catalog_search_compact(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT replace(catalog_search_words(input), ' ', '')
$function$;

-- Prefix each parsed lexeme so "oring" finds the indexed "orings" token. The
-- input has already had punctuation collapsed, which is what makes the same
-- index bridge "o-ring", "o ring" and "oring" without scanning every SKU.
CREATE OR REPLACE FUNCTION catalog_prefix_tsquery(input text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT to_tsquery(
    'simple',
    string_agg(quote_literal(lexeme) || ':*', ' & ')
  )
  FROM unnest(
    tsvector_to_array(to_tsvector('simple', catalog_search_words(input)))
  ) AS parsed(lexeme)
$function$;

-- One relevance score shared by autocomplete and the full results page.
-- Numeric gaps between tiers are intentional: product count and catalog sort
-- only break ties inside a relevance tier; they can never make a popular but
-- weak substring beat a punctuation-insensitive or typo-tolerant match.
CREATE OR REPLACE FUNCTION catalog_search_rank(needle text, candidate text)
RETURNS real
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH normalized AS (
    SELECT catalog_search_words(needle) AS needle_words,
           catalog_search_compact(needle) AS needle_compact,
           catalog_search_words(candidate) AS candidate_words,
           catalog_search_compact(candidate) AS candidate_compact
  ), similarity_score AS (
    SELECT normalized.*,
           greatest(
             strict_word_similarity(needle_words, candidate_words),
             similarity(needle_compact, candidate_compact)
           ) AS fuzzy
    FROM normalized
  )
  SELECT CASE
    WHEN needle_compact = '' OR candidate_compact = '' THEN 0
    WHEN candidate_compact = needle_compact THEN 1
    WHEN candidate_compact = needle_compact || 's'
      OR needle_compact = candidate_compact || 's' THEN 0.98
    WHEN candidate_words LIKE needle_compact || '%'
      OR candidate_words LIKE '% ' || needle_compact || '%' THEN 0.92
    WHEN candidate_compact LIKE needle_compact || '%' THEN 0.86
    ELSE greatest(
      CASE
        WHEN char_length(needle_compact) >= 3
          AND fuzzy >= CASE WHEN char_length(needle_compact) = 3 THEN 0.4 ELSE 0.3 END
        THEN 0.60 + fuzzy * 0.25
        ELSE 0
      END,
      CASE
        WHEN candidate_compact LIKE '%' || needle_compact || '%' THEN 0.55
        ELSE 0
      END
    )
  END::real
  FROM similarity_score
$function$;

-- Full-text search over the flattened product text.
CREATE INDEX IF NOT EXISTS products_fts_idx
  ON products USING GIN (to_tsvector('simple', search_text));

-- Same document, punctuation-normalized and queried with prefix lexemes. The
-- original index remains useful for exact FTS; this one powers smart search.
CREATE INDEX IF NOT EXISTS products_normalized_fts_idx
  ON products USING GIN (to_tsvector('simple', catalog_search_words(search_text)));

-- Prefix / fuzzy matching for part-number autocomplete.
CREATE INDEX IF NOT EXISTS products_part_number_trgm_idx
  ON products USING GIN (part_number gin_trgm_ops);

-- A SKU is case-insensitive at every application entry point. Keep the raw
-- unique index in schema.ts for the importer's ON CONFLICT(part_number), and
-- close the direct/concurrent-write gap with this expression index.
CREATE UNIQUE INDEX IF NOT EXISTS products_part_number_upper_key
  ON products (upper(part_number));

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
