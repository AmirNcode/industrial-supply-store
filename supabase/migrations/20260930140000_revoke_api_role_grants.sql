-- Takes every privilege on the app's tables, sequences and functions away from
-- Supabase's REST roles (review finding L-16). They held every table right —
-- TRUNCATE included — and USAGE/UPDATE on sequences such as invoice_seq, with
-- RLS-without-policies the only barrier. The app connects as the owner and
-- never uses these roles, so nothing it does changes. Default privileges are
-- revoked too, so tables created later start closed.
-- A plain Postgres (the self-hosted target) has no such roles: skipped there.
-- Forward-only and idempotent.

SET lock_timeout = '5s';

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
