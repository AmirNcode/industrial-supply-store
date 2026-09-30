-- Drops spec_defs.display, superseded by in_table/in_detail on 2026-08-20 and
-- read or written by nothing since (review finding L-4). It was kept for one
-- release so a rollback needed no restore; neither the live release nor this
-- one names it, so dropping it is safe in either deploy order.
-- Forward-only and idempotent.

SET lock_timeout = '5s';

ALTER TABLE spec_defs DROP CONSTRAINT IF EXISTS spec_defs_display_check;
ALTER TABLE spec_defs DROP COLUMN IF EXISTS display;
