-- Every part number a deleted product held, in any format, so none is ever
-- given to another product.
--
-- `part_number_registry` already keeps TEMEX-format codes after their product
-- goes, but only those: a supplier's own code, or a sample product's, left no
-- trace, and a later upload could hand it to something else. This list keeps
-- them all.
--
-- Filled by a trigger rather than by the application, because a product is
-- deleted from four places — a row in the admin table, a `replace` upload, a
-- family delete and a category delete (the last two by cascade, which fires
-- this trigger too) — and a fifth added later must not be able to forget.
-- Statement-level with a transition table, so a category delete removing
-- thousands of products is one insert, not thousands.
--
-- Forward-only and idempotent. The previous release never reads or writes this
-- table; its deletes simply start being recorded.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS retired_part_numbers (
  -- Upper-cased, like every part-number lookup in the app.
  part_number text PRIMARY KEY,
  retired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retired_part_numbers_upper_check CHECK (part_number = upper(part_number))
);

-- Written only by the owner role, which bypasses RLS; enabling it keeps the
-- list out of Supabase's REST API, like part_number_registry.
ALTER TABLE retired_part_numbers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION products_retire_part_numbers() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO retired_part_numbers (part_number)
  SELECT DISTINCT upper(part_number) FROM retired_products
  ON CONFLICT (part_number) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS products_retire_part_numbers ON products;
CREATE TRIGGER products_retire_part_numbers
  AFTER DELETE ON products
  REFERENCING OLD TABLE AS retired_products
  FOR EACH STATEMENT EXECUTE FUNCTION products_retire_part_numbers();

-- Products deleted before this existed: the registry kept their TEMEX codes
-- with no product attached. Other formats deleted earlier are not knowable.
INSERT INTO retired_part_numbers (part_number)
SELECT r.part_number FROM part_number_registry r
WHERE r.product_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM products p WHERE upper(p.part_number) = r.part_number)
ON CONFLICT (part_number) DO NOTHING;
