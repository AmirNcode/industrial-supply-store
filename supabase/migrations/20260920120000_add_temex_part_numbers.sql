-- TEMEX part numbers: a per-family 4-digit prefix, a per-family variant
-- counter, and a registry that outlives the products so no code is ever
-- reissued. Forward-only; `drizzle-kit push` is never run against this database.

ALTER TABLE product_families
  ADD COLUMN IF NOT EXISTS family_number integer,
  ADD COLUMN IF NOT EXISTS next_variant_ordinal integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS families_family_number_key
  ON product_families (family_number);

ALTER TABLE product_families
  DROP CONSTRAINT IF EXISTS product_families_family_number_check;
ALTER TABLE product_families
  ADD CONSTRAINT product_families_family_number_check
    CHECK (family_number IS NULL OR family_number BETWEEN 1000 AND 9999);

ALTER TABLE product_families
  DROP CONSTRAINT IF EXISTS product_families_next_variant_check;
ALTER TABLE product_families
  ADD CONSTRAINT product_families_next_variant_check
    CHECK (next_variant_ordinal BETWEEN 1 AND 23977);

CREATE TABLE IF NOT EXISTS part_number_registry (
  id serial PRIMARY KEY,
  part_number text NOT NULL,
  family_number integer NOT NULL,
  variant_ordinal integer NOT NULL,
  product_id integer REFERENCES products (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_number_registry_slot_check
    CHECK (variant_ordinal BETWEEN 1 AND 23976)
);

CREATE UNIQUE INDEX IF NOT EXISTS part_number_registry_key
  ON part_number_registry (part_number);
CREATE UNIQUE INDEX IF NOT EXISTS part_number_registry_slot_key
  ON part_number_registry (family_number, variant_ordinal);
CREATE INDEX IF NOT EXISTS part_number_registry_product_idx
  ON part_number_registry (product_id);

-- Earlier local feature testing created reservations without product_id.
-- Attach those reservations to their still-live products once, before the
-- strict ownership checks ship. This changes no product or part number.
UPDATE part_number_registry r
SET product_id = p.id
FROM products p
WHERE r.product_id IS NULL AND upper(p.part_number) = r.part_number;

-- Written only by the application's owner role, which bypasses RLS. Enabling
-- it here keeps the table out of Supabase's REST API, matching the posture of
-- request_rate_limits: a reservation list is not public data.
ALTER TABLE part_number_registry ENABLE ROW LEVEL SECURITY;
