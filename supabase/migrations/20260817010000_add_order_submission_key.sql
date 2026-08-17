-- One durable identity for a quote form submission. Existing orders predate
-- the mechanism and remain NULL; PostgreSQL unique indexes permit many NULLs.
-- New application writes always supply a signed UUID and use this index as the
-- correctness boundary for retries and concurrent double-submits.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS submission_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS orders_submission_key_key
  ON public.orders (submission_key);
