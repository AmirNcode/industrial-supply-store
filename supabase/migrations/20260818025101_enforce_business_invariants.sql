-- Make the database enforce the numeric, ownership and lifecycle assumptions
-- the application already depends on. Constraints are added NOT VALID first:
-- existing rows are checked explicitly, then PostgreSQL validates without the
-- longer ACCESS EXCLUSIVE lock required by a one-step ADD CHECK.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $$
DECLARE
  blockers bigint;
BEGIN
  SELECT count(*) INTO blockers
  FROM (
    SELECT upper(part_number) FROM public.products
    GROUP BY upper(part_number) HAVING count(*) > 1
  ) duplicate_skus;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce SKU uniqueness: % case-insensitive duplicate group(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.orders o
  LEFT JOIN public.users u ON u.id = o.user_id
  WHERE o.user_id IS NOT NULL AND u.id IS NULL;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot add orders.user_id foreign key: % orphan order(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.categories
  WHERE depth < 0 OR product_count < 0;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce category ranges: % invalid row(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.product_families
  WHERE product_count < 0;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce family ranges: % invalid row(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.products
  WHERE part_number <> btrim(part_number)
     OR part_number = ''
     OR price_cents < 0
     OR jsonb_typeof(price_tiers) <> 'array'
     OR jsonb_path_exists(
       price_tiers,
       '$[*] ? (@.type() != "object" || !(exists(@.minQty)) || !(exists(@.priceCents)) || @.minQty.type() != "number" || @.priceCents.type() != "number" || @.minQty <= 0 || @.priceCents < 0)'
     )
     OR pack_qty <= 0
     OR lead_days < 0
     OR inventory_on_hold < 0
     OR inventory_sold < 0;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce product ranges: % invalid row(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers FROM public.cart_items WHERE qty <= 0;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce cart quantity: % invalid row(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.order_items
  WHERE qty <= 0 OR requested_unit_price_cents < 0 OR unit_price_cents < 0;
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce order item ranges: % invalid row(s)', blockers;
  END IF;

  SELECT count(*) INTO blockers
  FROM public.orders
  WHERE requested_total_cents < 0
     OR total_cents < 0
     OR NOT (
       (
         invoice_number IS NULL
         AND fx_rate_to_toman IS NULL
         AND invoiced_at IS NULL
       ) OR (
         invoice_number IS NOT NULL
         AND btrim(invoice_number) <> ''
         AND fx_rate_to_toman > 0
         AND invoiced_at IS NOT NULL
       )
     )
     OR NOT (
       (invoiced_at IS NULL OR invoiced_at >= created_at)
       AND (paid_at IS NULL OR (invoiced_at IS NOT NULL AND paid_at >= invoiced_at))
       AND (shipped_at IS NULL OR (paid_at IS NOT NULL AND shipped_at >= paid_at))
       AND (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at))
     )
     OR NOT (
       (status <> 'received' OR invoiced_at IS NULL)
       AND (status NOT IN ('invoiced','preparing','shipped','delivered') OR invoiced_at IS NOT NULL)
       AND (status NOT IN ('preparing','shipped','delivered') OR paid_at IS NOT NULL)
       AND (status NOT IN ('shipped','delivered') OR shipped_at IS NOT NULL)
       AND (status <> 'delivered' OR delivered_at IS NOT NULL)
       AND (status <> 'invoiced' OR paid_at IS NULL)
       AND (status <> 'preparing' OR shipped_at IS NULL)
       AND (status <> 'shipped' OR delivered_at IS NULL)
       AND (status <> 'cancelled' OR (shipped_at IS NULL AND delivered_at IS NULL))
     );
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce order lifecycle ranges: % invalid row(s)', blockers;
  END IF;
END
$$;

-- Drizzle cannot model expression indexes. extensions.sql owns this object as
-- well so a later db:push restores it instead of silently weakening the rule.
CREATE UNIQUE INDEX IF NOT EXISTS products_part_number_upper_key
  ON public.products (upper(part_number));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.categories'::regclass AND conname = 'categories_depth_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_depth_check CHECK (depth >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.categories'::regclass AND conname = 'categories_product_count_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_product_count_check CHECK (product_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_families'::regclass
      AND conname = 'product_families_product_count_check'
  ) THEN
    ALTER TABLE public.product_families
      ADD CONSTRAINT product_families_product_count_check
      CHECK (product_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_part_number_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_part_number_check
      CHECK (part_number = btrim(part_number) AND part_number <> '') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_price_cents_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_price_cents_check CHECK (price_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_price_tiers_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_price_tiers_check CHECK (
        jsonb_typeof(price_tiers) = 'array'
        AND NOT jsonb_path_exists(
          price_tiers,
          '$[*] ? (@.type() != "object" || !(exists(@.minQty)) || !(exists(@.priceCents)) || @.minQty.type() != "number" || @.priceCents.type() != "number" || @.minQty <= 0 || @.priceCents < 0)'
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_pack_qty_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_pack_qty_check CHECK (pack_qty > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_lead_days_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_lead_days_check CHECK (lead_days >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_inventory_on_hold_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_inventory_on_hold_check
      CHECK (inventory_on_hold >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_inventory_sold_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_inventory_sold_check
      CHECK (inventory_sold >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cart_items'::regclass AND conname = 'cart_items_qty_check'
  ) THEN
    ALTER TABLE public.cart_items
      ADD CONSTRAINT cart_items_qty_check CHECK (qty > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_user_id_users_id_fk'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_totals_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_totals_check
      CHECK (requested_total_cents >= 0 AND total_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_invoice_fields_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_invoice_fields_check CHECK (
        (
          invoice_number IS NULL
          AND fx_rate_to_toman IS NULL
          AND invoiced_at IS NULL
        ) OR (
          invoice_number IS NOT NULL
          AND btrim(invoice_number) <> ''
          AND fx_rate_to_toman > 0
          AND invoiced_at IS NOT NULL
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_timestamp_chain_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_timestamp_chain_check CHECK (
        (invoiced_at IS NULL OR invoiced_at >= created_at)
        AND (paid_at IS NULL OR (invoiced_at IS NOT NULL AND paid_at >= invoiced_at))
        AND (shipped_at IS NULL OR (paid_at IS NOT NULL AND shipped_at >= paid_at))
        AND (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at))
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_status_timestamps_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_status_timestamps_check CHECK (
        (status <> 'received' OR invoiced_at IS NULL)
        AND (status NOT IN ('invoiced','preparing','shipped','delivered') OR invoiced_at IS NOT NULL)
        AND (status NOT IN ('preparing','shipped','delivered') OR paid_at IS NOT NULL)
        AND (status NOT IN ('shipped','delivered') OR shipped_at IS NOT NULL)
        AND (status <> 'delivered' OR delivered_at IS NOT NULL)
        AND (status <> 'invoiced' OR paid_at IS NULL)
        AND (status <> 'preparing' OR shipped_at IS NULL)
        AND (status <> 'shipped' OR delivered_at IS NULL)
        AND (status <> 'cancelled' OR (shipped_at IS NULL AND delivered_at IS NULL))
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_items'::regclass AND conname = 'order_items_qty_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_qty_check CHECK (qty > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_items'::regclass AND conname = 'order_items_prices_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_prices_check
      CHECK (requested_unit_price_cents >= 0 AND unit_price_cents >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.categories VALIDATE CONSTRAINT categories_depth_check;
ALTER TABLE public.categories VALIDATE CONSTRAINT categories_product_count_check;
ALTER TABLE public.product_families VALIDATE CONSTRAINT product_families_product_count_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_part_number_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_price_cents_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_price_tiers_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_pack_qty_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_lead_days_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_inventory_on_hold_check;
ALTER TABLE public.products VALIDATE CONSTRAINT products_inventory_sold_check;
ALTER TABLE public.cart_items VALIDATE CONSTRAINT cart_items_qty_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_user_id_users_id_fk;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_totals_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_invoice_fields_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_timestamp_chain_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_timestamps_check;
ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_qty_check;
ALTER TABLE public.order_items VALIDATE CONSTRAINT order_items_prices_check;
