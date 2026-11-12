-- The rep portal's "orders I placed" lookup reads orders by placed_by_rep_id.
-- Without an index that is a scan of the whole orders table on every visit;
-- partial, because most orders are not placed by a rep.
--
-- Forward-only and idempotent. A separate file from the commission-splits
-- migration because that one is already applied in places, and the migrate
-- ledger compares statements.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS orders_placed_by_rep_idx ON orders (placed_by_rep_id)
  WHERE placed_by_rep_id IS NOT NULL;
