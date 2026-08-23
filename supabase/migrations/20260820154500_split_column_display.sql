-- Split `spec_defs.display` into two independent flags.
--
-- The enum could say "in the table" or "in the expanded row" but never both and
-- never neither, so an operator had no way to hide a column outright — and
-- every column taken out of the table was silently pushed into the expanded
-- row instead.
--
-- `display` is deliberately left in place and unread. Dropping it in the same
-- deploy as the code that stops reading it would leave no way back but a
-- restore; a second migration removes it once this release is proven.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.spec_defs
  ADD COLUMN IF NOT EXISTS in_table boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS in_detail boolean NOT NULL DEFAULT false;

-- Every family keeps rendering exactly as it does today: a table column stays
-- out of the expanded row, a detail column stays out of the table.
UPDATE public.spec_defs
   SET in_table = (display = 'table'),
       in_detail = (display = 'detail');

COMMENT ON COLUMN public.spec_defs.in_table IS
  'Renders as a catalog spec-table column. Independent of in_detail; neither set means the column renders nowhere.';

COMMENT ON COLUMN public.spec_defs.in_detail IS
  'Renders in the expanded product row. Independent of in_table.';

COMMENT ON COLUMN public.spec_defs.display IS
  'Superseded by in_table/in_detail on 2026-08-20. Retained unread for one release; dropped by a later migration.';
