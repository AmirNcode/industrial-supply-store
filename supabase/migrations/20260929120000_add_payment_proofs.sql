-- Proof of payment: receipts customers (or their rep) upload after a bank
-- transfer, and the new `payment_review` status an order waits in until the
-- admin or its rep confirms the money arrived. Files live in a private Storage
-- bucket; this table says whose they are.
-- Forward-only and idempotent. Constraint names match what drizzle-kit
-- generates from src/db/schema.ts.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_confirmed_by_rep_id uuid
    CONSTRAINT orders_paid_confirmed_by_rep_id_sales_reps_id_fk
    REFERENCES sales_reps (id) ON DELETE RESTRICT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('received','invoiced','payment_review','preparing','shipped','delivered','cancelled'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_timestamp_chain_check;
ALTER TABLE orders ADD CONSTRAINT orders_timestamp_chain_check CHECK (
  (invoiced_at IS NULL OR invoiced_at >= created_at)
  AND (payment_submitted_at IS NULL OR (invoiced_at IS NOT NULL AND payment_submitted_at >= invoiced_at))
  AND (paid_at IS NULL OR (invoiced_at IS NOT NULL AND paid_at >= invoiced_at))
  AND (paid_confirmed_by_rep_id IS NULL OR paid_at IS NOT NULL)
  AND (shipped_at IS NULL OR (paid_at IS NOT NULL AND shipped_at >= paid_at))
  AND (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at))
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_timestamps_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_timestamps_check CHECK (
  (status <> 'received' OR invoiced_at IS NULL)
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

CREATE TABLE IF NOT EXISTS payment_proofs (
  id serial PRIMARY KEY,
  order_id integer NOT NULL
    CONSTRAINT payment_proofs_order_id_orders_id_fk REFERENCES orders (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  uploaded_by text NOT NULL,
  rep_id uuid
    CONSTRAINT payment_proofs_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_proofs_storage_path_key ON payment_proofs (storage_path);
CREATE INDEX IF NOT EXISTS payment_proofs_order_idx ON payment_proofs (order_id, created_at);
ALTER TABLE payment_proofs DROP CONSTRAINT IF EXISTS payment_proofs_content_type_check;
ALTER TABLE payment_proofs ADD CONSTRAINT payment_proofs_content_type_check
  CHECK (content_type IN ('image/jpeg','image/png','image/webp','application/pdf'));
ALTER TABLE payment_proofs DROP CONSTRAINT IF EXISTS payment_proofs_size_check;
ALTER TABLE payment_proofs ADD CONSTRAINT payment_proofs_size_check
  CHECK (byte_size BETWEEN 1 AND 4000000);
ALTER TABLE payment_proofs DROP CONSTRAINT IF EXISTS payment_proofs_uploaded_by_check;
ALTER TABLE payment_proofs ADD CONSTRAINT payment_proofs_uploaded_by_check
  CHECK ((uploaded_by = 'customer' AND rep_id IS NULL) OR (uploaded_by = 'rep' AND rep_id IS NOT NULL));
-- Written only by the application's owner role, which bypasses RLS. Enabling
-- it keeps receipts' paths out of Supabase's REST API.
ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;
