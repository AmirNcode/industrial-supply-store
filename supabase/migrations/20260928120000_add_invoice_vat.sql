-- VAT on invoices: the rate in basis points, locked onto an order when its
-- invoice is finalized so a later change to the setting never restates an
-- invoice already sent. Existing invoices keep NULL — they were issued without
-- VAT and must keep printing none. The rate itself is an app_settings row
-- (`vat_rate_bp`) and needs no schema.
-- Forward-only and idempotent. The constraint name matches what drizzle-kit
-- generates from src/db/schema.ts.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate_bp integer;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_vat_rate_check;
ALTER TABLE orders ADD CONSTRAINT orders_vat_rate_check
  CHECK (vat_rate_bp IS NULL OR (invoice_number IS NOT NULL AND vat_rate_bp BETWEEN 0 AND 10000));
