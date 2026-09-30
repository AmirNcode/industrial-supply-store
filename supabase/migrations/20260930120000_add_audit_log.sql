-- An append-only record of who changed money or order state (review finding
-- M-11): order status moves, invoices, payment confirmations and receipts,
-- password resets, customer reassignments, pay-link replacements and rep
-- payouts. Written in the same transaction (or statement) as the change it
-- records. The admin is one shared password, so an admin row names no person.
-- Forward-only and idempotent; a new table, so the previous release is
-- unaffected by it.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL,
  actor_id text,
  action text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_log_actor_kind_check CHECK (actor_kind IN ('admin', 'rep', 'customer', 'system'))
);
CREATE INDEX IF NOT EXISTS audit_log_subject_idx ON audit_log (subject_kind, subject_id, at);
-- Written only by the application's owner role, which bypasses RLS.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- A payout recorded by mistake is voided, not deleted: the record stays.
ALTER TABLE rep_payouts ADD COLUMN IF NOT EXISTS voided_at timestamptz;
