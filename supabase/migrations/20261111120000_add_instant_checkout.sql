-- Instant checkout: a pish-factor at checkout instead of a quote request and a
-- wait. Adds order deadlines, the `quoted` status, back-order lines, saved
-- delivery addresses, emailed sign-in codes and the email log.
--
-- What changes meaning:
--   * An order is "invoiced" once `invoiced_at` and the locked rate are set.
--     `invoice_number` now arrives only when payment is confirmed, so the
--     checks that keyed on it key on `invoiced_at` instead. Orders already
--     numbered while unpaid stay valid.
--   * A back-order line never holds stock; the inventory ledger skips it.
-- Open orders that predate this get no deadline (`expires_at` stays NULL):
-- nobody was told they had one.
-- Forward-only and idempotent. Constraint names match what drizzle-kit
-- generates from src/db/schema.ts.

-- Fail fast rather than queue behind live traffic holding a lock (L-13).
SET lock_timeout = '5s';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS group_id uuid,
  ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_national_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_economic_code text NOT NULL DEFAULT '';

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS backorder boolean NOT NULL DEFAULT false;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('received','quoted','invoiced','payment_review','preparing','shipped','delivered','cancelled'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_invoice_fields_check;
ALTER TABLE orders ADD CONSTRAINT orders_invoice_fields_check CHECK (
  (
    invoiced_at IS NULL
    AND fx_rate_to_rial IS NULL
    AND invoice_number IS NULL
  ) OR (
    invoiced_at IS NOT NULL
    AND fx_rate_to_rial > 0
    AND (invoice_number IS NULL OR btrim(invoice_number) <> '')
  )
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_vat_rate_check;
ALTER TABLE orders ADD CONSTRAINT orders_vat_rate_check CHECK (
  vat_rate_bp IS NULL OR (invoiced_at IS NOT NULL AND vat_rate_bp BETWEEN 0 AND 10000)
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_timestamps_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_timestamps_check CHECK (
  (status NOT IN ('received','quoted') OR invoiced_at IS NULL)
  AND (status <> 'quoted' OR quoted_at IS NOT NULL)
  AND (status NOT IN ('invoiced','payment_review','preparing','shipped','delivered') OR invoiced_at IS NOT NULL)
  AND (status NOT IN ('preparing','shipped','delivered') OR paid_at IS NOT NULL)
  AND (status NOT IN ('shipped','delivered') OR shipped_at IS NOT NULL)
  AND (status <> 'delivered' OR delivered_at IS NOT NULL)
  AND (status NOT IN ('invoiced','payment_review') OR paid_at IS NULL)
  AND (status <> 'payment_review' OR payment_submitted_at IS NOT NULL)
  AND (status <> 'preparing' OR shipped_at IS NULL)
  AND (status <> 'shipped' OR delivered_at IS NULL)
  AND (status <> 'cancelled' OR (shipped_at IS NULL AND delivered_at IS NULL))
);

-- A paid order always carries its official number; an automatic cancel is
-- only ever recorded on a cancelled order; a deadline only on an open one.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_paid_invoice_number_check;
ALTER TABLE orders ADD CONSTRAINT orders_paid_invoice_number_check
  CHECK (paid_at IS NULL OR invoice_number IS NOT NULL);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_expiry_check;
ALTER TABLE orders ADD CONSTRAINT orders_expiry_check CHECK (
  (expired_at IS NULL OR status = 'cancelled')
  AND (expires_at IS NULL OR status IN ('received','quoted','invoiced'))
);

CREATE INDEX IF NOT EXISTS orders_expires_idx ON orders (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_group_idx ON orders (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS national_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS economic_code text NOT NULL DEFAULT '';

-- Accounts that exist today chose their own password under the old rules.
-- Treating them as unverified would lock out any whose address cannot receive
-- a code, so they are grandfathered.
UPDATE users SET email_verified_at = created_at
WHERE email IS NOT NULL AND email_verified_at IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_origin_check;
ALTER TABLE users ADD CONSTRAINT users_origin_check CHECK (
  origin IN ('self','rep','referral','checkout')
  AND (origin IN ('self','checkout') OR origin_rep_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    CONSTRAINT user_addresses_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL,
  city text NOT NULL,
  postal_code text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON user_addresses (user_id, created_at);
-- One default per account, enforced here rather than by the code that sets it.
CREATE UNIQUE INDEX IF NOT EXISTS user_addresses_default_key ON user_addresses (user_id) WHERE is_default;
ALTER TABLE user_addresses DROP CONSTRAINT IF EXISTS user_addresses_filled_check;
ALTER TABLE user_addresses ADD CONSTRAINT user_addresses_filled_check
  CHECK (btrim(address) <> '' AND btrim(city) <> '');
ALTER TABLE user_addresses ENABLE ROW LEVEL SECURITY;

-- The single address an account could hold becomes its first saved one.
INSERT INTO user_addresses (user_id, address, city, is_default)
SELECT u.id, btrim(u.address), btrim(u.city), true
FROM users u
WHERE btrim(u.address) <> '' AND btrim(u.city) <> ''
  AND NOT EXISTS (SELECT 1 FROM user_addresses a WHERE a.user_id = u.id);

CREATE TABLE IF NOT EXISTS login_codes (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL
    CONSTRAINT login_codes_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_codes_user_idx ON login_codes (user_id, created_at);
ALTER TABLE login_codes DROP CONSTRAINT IF EXISTS login_codes_attempts_check;
ALTER TABLE login_codes ADD CONSTRAINT login_codes_attempts_check CHECK (attempts >= 0);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_log (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  order_id integer
    CONSTRAINT email_log_order_id_orders_id_fk REFERENCES orders (id) ON DELETE SET NULL,
  status text NOT NULL,
  provider_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at);
ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent','logged','failed'));
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
