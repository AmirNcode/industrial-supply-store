-- Sales reps: admin-created accounts with their own sign-in; customer IDs;
-- rep credit and commission locked onto each order when it is placed; a
-- private pay link per order; customer notes, payouts and monthly targets.
-- Forward-only and idempotent. Constraint names match what drizzle-kit
-- generates from src/db/schema.ts, so a pushed local database and a migrated
-- hosted one verify identically.

CREATE TABLE IF NOT EXISTS sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  commission_rate_bp integer NOT NULL DEFAULT 0,
  referral_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_username_key ON sales_reps (username);
CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_referral_code_key ON sales_reps (referral_code);
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_username_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_username_check
  CHECK (username ~ '^[a-z0-9._-]{3,32}$');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_name_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_name_check CHECK (btrim(name) <> '');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_commission_rate_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_commission_rate_check
  CHECK (commission_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_referral_code_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_referral_code_check
  CHECK (referral_code ~ '^[A-HJ-NP-Z2-9]{6}$');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_session_version_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_session_version_check CHECK (session_version > 0);
-- Written only by the application's owner role, which bypasses RLS. Enabling
-- it keeps password hashes out of Supabase's REST API.
ALTER TABLE sales_reps ENABLE ROW LEVEL SECURITY;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS rep_id uuid
    CONSTRAINT users_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rep_earns_commission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS origin_rep_id uuid
    CONSTRAINT users_origin_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  -- True once the customer has chosen a password themselves. Every existing
  -- account signed up with its own, hence the default; only an account a rep
  -- creates starts false. A rep may reset only an account they created that
  -- has never had one (review finding H-4).
  ADD COLUMN IF NOT EXISTS chose_own_password boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS next_follow_up_on date;

-- A rep-created customer may have no email; sign-in then uses the customer ID.
-- The lower(email) unique index in extensions.sql still applies: NULLs never
-- collide.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Existing customers: the phone's last seven digits when free, otherwise a
-- random seven-digit number. Oldest accounts choose first.
DO $$
DECLARE
  u record;
  candidate text;
BEGIN
  FOR u IN SELECT id, phone FROM users WHERE customer_code IS NULL ORDER BY created_at, id LOOP
    candidate := right(
      regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                     '[^0-9]', '', 'g'),
      7);
    IF length(candidate) <> 7
       OR EXISTS (SELECT 1 FROM users WHERE customer_code = candidate) THEN
      LOOP
        candidate := (1000000 + floor(random() * 9000000))::int::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE customer_code = candidate);
      END LOOP;
    END IF;
    UPDATE users SET customer_code = candidate WHERE id = u.id;
  END LOOP;
END $$;

-- The same choice for any insert that names no code — above all the previous
-- release's sign-up, which does not know the column exists. The deploy order
-- is migration first, code second, and a rollback runs the old code against
-- this schema again; without a default every sign-up in those windows failed
-- on the NOT NULL below (review finding H-10). The new code always supplies a
-- code, so this fires only for older writers. Kept in step with the loop
-- above and with `codeFromPhone` in src/lib/customerCode.ts.
CREATE OR REPLACE FUNCTION users_assign_customer_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate text;
BEGIN
  IF NEW.customer_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  candidate := right(
    regexp_replace(translate(coalesce(NEW.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                   '[^0-9]', '', 'g'),
    7);
  IF length(candidate) <> 7
     OR EXISTS (SELECT 1 FROM users WHERE customer_code = candidate) THEN
    LOOP
      candidate := (1000000 + floor(random() * 9000000))::int::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE customer_code = candidate);
    END LOOP;
  END IF;
  NEW.customer_code := candidate;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_customer_code_default ON users;
CREATE TRIGGER users_customer_code_default BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_assign_customer_code();

ALTER TABLE users ALTER COLUMN customer_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_customer_code_key ON users (customer_code);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_code_check;
ALTER TABLE users ADD CONSTRAINT users_customer_code_check CHECK (customer_code ~ '^[0-9]{7}$');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_origin_check;
ALTER TABLE users ADD CONSTRAINT users_origin_check
  CHECK (origin IN ('self', 'rep', 'referral') AND (origin = 'self' OR origin_rep_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS users_rep_idx ON users (rep_id, created_at);
CREATE INDEX IF NOT EXISTS users_rep_follow_up_idx ON users (rep_id, next_follow_up_on)
  WHERE next_follow_up_on IS NOT NULL;

-- A volatile default is evaluated per row, so every existing order receives
-- its own token here, and no INSERT anywhere has to name the column.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rep_id uuid
    CONSTRAINT orders_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_rate_bp integer,
  ADD COLUMN IF NOT EXISTS placed_by_rep boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_token text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_token_key ON orders (pay_token);
CREATE INDEX IF NOT EXISTS orders_rep_delivered_idx ON orders (rep_id, delivered_at)
  WHERE rep_id IS NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_commission_check;
-- Written with IS NULL on both sides: a CHECK whose expression is NULL
-- passes, so `rep_id IS NOT NULL AND commission_rate_bp BETWEEN …` would let
-- a credited order with no rate through.
ALTER TABLE orders ADD CONSTRAINT orders_commission_check CHECK (
  (rep_id IS NULL) = (commission_rate_bp IS NULL)
  AND (commission_rate_bp IS NULL OR commission_rate_bp BETWEEN 0 AND 10000)
);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_placed_by_rep_check;
ALTER TABLE orders ADD CONSTRAINT orders_placed_by_rep_check
  CHECK (NOT placed_by_rep OR rep_id IS NOT NULL);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pay_token_check;
ALTER TABLE orders ADD CONSTRAINT orders_pay_token_check CHECK (pay_token ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS customer_notes (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL
    CONSTRAINT customer_notes_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  author_rep_id uuid
    CONSTRAINT customer_notes_author_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_body_check CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
CREATE INDEX IF NOT EXISTS customer_notes_user_idx ON customer_notes (user_id, created_at);
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rep_payouts (
  id serial PRIMARY KEY,
  rep_id uuid NOT NULL
    CONSTRAINT rep_payouts_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  amount_rial bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rep_payouts_amount_check CHECK (amount_rial > 0),
  CONSTRAINT rep_payouts_note_check CHECK (char_length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS rep_payouts_rep_idx ON rep_payouts (rep_id, created_at);
ALTER TABLE rep_payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rep_targets (
  rep_id uuid NOT NULL
    CONSTRAINT rep_targets_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE CASCADE,
  persian_year integer NOT NULL,
  persian_month integer NOT NULL,
  amount_rial bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rep_targets_rep_id_persian_year_persian_month_pk
    PRIMARY KEY (rep_id, persian_year, persian_month),
  CONSTRAINT rep_targets_month_check
    CHECK (persian_year BETWEEN 1300 AND 1600 AND persian_month BETWEEN 1 AND 12),
  CONSTRAINT rep_targets_amount_check CHECK (amount_rial >= 0)
);
ALTER TABLE rep_targets ENABLE ROW LEVEL SECURITY;
