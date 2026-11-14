-- Deleting a product makes Postgres look up its rows in cart_items (to delete
-- them) and order_items (to blank product_id). Neither column was indexed —
-- cart_items' key starts with cart_id — so each deleted product scanned both
-- tables in full, and deleting a large family from admin would run past the
-- statement timeout once carts and order lines number in the tens of
-- thousands (review R-11).
--
-- Forward-only and idempotent; old code is unaffected by an added index.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS cart_items_product_idx ON cart_items (product_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);
