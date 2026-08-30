-- Convert every persisted local-currency value from Toman to Rial while
-- preserving USD cents as the catalog/order source of truth. The column check
-- makes this migration safe on both an existing database and a fresh database
-- that was first bootstrapped from the current Drizzle schema.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $$
DECLARE
  has_toman_column boolean;
  has_rial_column boolean;
  blockers bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'fx_rate_to_toman'
  ) INTO has_toman_column;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'fx_rate_to_rial'
  ) INTO has_rial_column;

  IF has_toman_column AND has_rial_column THEN
    RAISE EXCEPTION 'cannot migrate currency: both frozen-rate columns exist';
  ELSIF NOT has_toman_column AND NOT has_rial_column THEN
    RAISE EXCEPTION 'cannot migrate currency: no frozen-rate column exists';
  END IF;

  IF has_toman_column THEN
    SELECT count(*) INTO blockers
    FROM public.orders
    WHERE fx_rate_to_toman IS NOT NULL
      AND (fx_rate_to_toman <= 0 OR fx_rate_to_toman > 214748364);
    IF blockers > 0 THEN
      RAISE EXCEPTION 'cannot convert frozen rates to Rial: % invalid or overflowing order(s)', blockers;
    END IF;

    SELECT count(*) INTO blockers
    FROM public.app_settings
    WHERE key = 'fx_manual_rate'
      AND CASE
        WHEN value ~ '^[0-9]+$'
          THEN value::numeric <= 0 OR value::numeric > 214748364
        ELSE true
      END;
    IF blockers > 0 THEN
      RAISE EXCEPTION 'cannot convert manual rate to Rial: stored value is invalid or too large';
    END IF;

    ALTER TABLE public.orders RENAME COLUMN fx_rate_to_toman TO fx_rate_to_rial;
    UPDATE public.orders
    SET fx_rate_to_rial = fx_rate_to_rial * 10
    WHERE fx_rate_to_rial IS NOT NULL;

    UPDATE public.app_settings
    SET value = ((value::numeric * 10)::bigint)::text,
        updated_at = now()
    WHERE key = 'fx_manual_rate';
  END IF;
END
$$;

UPDATE public.orders SET currency = 'IRR' WHERE currency = 'IRT';
ALTER TABLE public.orders ALTER COLUMN currency SET DEFAULT 'IRR';

DO $$
DECLARE
  blockers bigint;
BEGIN
  SELECT count(*) INTO blockers
  FROM public.orders
  WHERE currency NOT IN ('USD', 'IRR');
  IF blockers > 0 THEN
    RAISE EXCEPTION 'cannot enforce order currency: % unsupported row(s)', blockers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_currency_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_currency_check
      CHECK (currency IN ('USD', 'IRR')) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_currency_check;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('price_display_mode', 'irr', now())
ON CONFLICT (key) DO NOTHING;
