-- Descriptions and dimension diagrams for the catalog taxonomy.
--
-- `product_families` already carries about_en/about_fa; only categories are
-- gaining the pair, so the two entity types describe themselves the same way
-- and one callout component can render either.
--
-- Every column defaults to an empty string, exactly as `image_url` does, so
-- every existing row is valid the moment this lands and nothing needs backfill.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS about_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about_fa text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS diagram_url text NOT NULL DEFAULT '';

ALTER TABLE public.product_families
  ADD COLUMN IF NOT EXISTS diagram_url text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.categories.diagram_url IS
  'Second image slot: a labelled dimension diagram, shown beside the description. Falls back to image_url at thumbnail size.';

COMMENT ON COLUMN public.product_families.diagram_url IS
  'Second image slot: a labelled dimension diagram, shown beside the description. Falls back to image_url at thumbnail size.';
