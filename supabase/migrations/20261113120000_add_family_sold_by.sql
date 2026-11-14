-- Whether a family is sold in packages or by single units. A unit family
-- shows no "Pkg. Qty" column and prices each item; products.pack_qty is kept
-- (it is admin data, and a family switched back to packages gets it again).
--
-- Existing families start as 'unit' when they have products and every one of
-- them is a pack of one — that is how the catalog already presents them. An
-- empty family keeps the default, 'package', the same as a new family.
--
-- Forward-only and idempotent: the column and check are guarded, and the
-- backfill only runs in the same statement batch that adds the column.

SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_families' AND column_name = 'sold_by'
  ) THEN
    ALTER TABLE product_families ADD COLUMN sold_by text NOT NULL DEFAULT 'package';
    ALTER TABLE product_families ADD CONSTRAINT product_families_sold_by_check
      CHECK (sold_by IN ('package', 'unit'));
    UPDATE product_families f SET sold_by = 'unit'
    WHERE EXISTS (SELECT 1 FROM products p WHERE p.family_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.family_id = f.id AND p.pack_qty > 1);
  END IF;
END $$;
