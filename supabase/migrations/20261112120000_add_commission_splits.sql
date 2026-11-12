-- Commission splits: an account may have up to five reps, and an order's
-- commission is shared between them.
--
-- What changes meaning:
--   * Who owns a customer is now `customer_reps` (one row per rep, with an
--     optional share), not `users.rep_id`. The old column stays and is still
--     written, so the release running during the deploy keeps working.
--   * Who earns on an order is now `order_rep_shares`, fixed at placement.
--     An order with no rep, or one not yet claimed, has no rows.
--   * `users.commission_rate_bp` is an account-level override; NULL means
--     "follow the lead rep's rate".
--   * `orders.placed_by_rep_id` names the rep who placed an order for a
--     customer. `orders.rep_id` and `commission_rate_bp` may now both be NULL
--     on an unclaimed order, but a credited order still needs its rate.
-- Forward-only and idempotent. Constraint names match what drizzle-kit
-- generates from src/db/schema.ts.

SET lock_timeout = '5s';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS commission_rate_bp integer;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_commission_rate_check;
ALTER TABLE users ADD CONSTRAINT users_commission_rate_check
  CHECK (commission_rate_bp IS NULL OR commission_rate_bp BETWEEN 0 AND 10000);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS placed_by_rep_id uuid;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_placed_by_rep_id_sales_reps_id_fk;
ALTER TABLE orders ADD CONSTRAINT orders_placed_by_rep_id_sales_reps_id_fk
  FOREIGN KEY (placed_by_rep_id) REFERENCES sales_reps (id) ON DELETE RESTRICT;

-- Relaxed so an unclaimed order (no rep, no rate) is valid, and so a release
-- that still writes only the old columns can keep writing.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_commission_check;
ALTER TABLE orders ADD CONSTRAINT orders_commission_check CHECK (
  (commission_rate_bp IS NULL OR commission_rate_bp BETWEEN 0 AND 10000)
  AND (rep_id IS NULL OR commission_rate_bp IS NOT NULL)
);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_placed_by_rep_check;
ALTER TABLE orders ADD CONSTRAINT orders_placed_by_rep_check
  CHECK (NOT placed_by_rep OR rep_id IS NOT NULL OR placed_by_rep_id IS NOT NULL);

-- share_bp NULL means "no share chosen": the account's reps split equally.
CREATE TABLE IF NOT EXISTS customer_reps (
  user_id uuid NOT NULL
    CONSTRAINT customer_reps_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  rep_id uuid NOT NULL
    CONSTRAINT customer_reps_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  share_bp integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_reps_user_id_rep_id_pk PRIMARY KEY (user_id, rep_id)
);
CREATE INDEX IF NOT EXISTS customer_reps_rep_idx ON customer_reps (rep_id, user_id);
ALTER TABLE customer_reps DROP CONSTRAINT IF EXISTS customer_reps_share_check;
ALTER TABLE customer_reps ADD CONSTRAINT customer_reps_share_check
  CHECK (share_bp IS NULL OR share_bp BETWEEN 1 AND 10000);

CREATE TABLE IF NOT EXISTS order_rep_shares (
  order_id integer NOT NULL
    CONSTRAINT order_rep_shares_order_id_orders_id_fk REFERENCES orders (id) ON DELETE CASCADE,
  rep_id uuid NOT NULL
    CONSTRAINT order_rep_shares_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  share_bp integer NOT NULL,
  CONSTRAINT order_rep_shares_order_id_rep_id_pk PRIMARY KEY (order_id, rep_id)
);
CREATE INDEX IF NOT EXISTS order_rep_shares_rep_idx ON order_rep_shares (rep_id, order_id);
ALTER TABLE order_rep_shares DROP CONSTRAINT IF EXISTS order_rep_shares_share_check;
ALTER TABLE order_rep_shares ADD CONSTRAINT order_rep_shares_share_check
  CHECK (share_bp BETWEEN 1 AND 10000);

ALTER TABLE customer_reps ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_rep_shares ENABLE ROW LEVEL SECURITY;

-- Same closure as 20260930140000_revoke_api_role_grants.sql, for the new
-- tables. A plain Postgres (the self-hosted target) has no such roles: skipped.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE customer_reps, order_rep_shares FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- backfill:begin
INSERT INTO customer_reps (user_id, rep_id, share_bp)
SELECT id, rep_id, NULL FROM users WHERE rep_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Customers who did not earn their rep commission keep earning nothing.
UPDATE users SET commission_rate_bp = 0
WHERE rep_id IS NOT NULL AND NOT rep_earns_commission AND commission_rate_bp IS NULL;

INSERT INTO order_rep_shares (order_id, rep_id, share_bp)
SELECT id, rep_id, 10000 FROM orders WHERE rep_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE orders SET placed_by_rep_id = rep_id
WHERE placed_by_rep AND placed_by_rep_id IS NULL;
-- backfill:end
