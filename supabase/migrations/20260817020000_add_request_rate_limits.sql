-- Shared fixed-window counters for public entry points. The caller identity is
-- HMACed by the application; this table never stores a raw IP address.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.request_rate_limits (
  scope text NOT NULL,
  identity_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  CONSTRAINT request_rate_limits_pkey PRIMARY KEY (scope, identity_hash),
  CONSTRAINT request_rate_limits_count_check CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS request_rate_limits_expires_idx
  ON public.request_rate_limits (expires_at);

-- The app reaches Postgres directly. There is no reason for an anonymous or
-- authenticated Supabase API client to inspect or edit abuse counters.
ALTER TABLE public.request_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.request_rate_limits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.request_rate_limits FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE public.request_rate_limits IS
  'Application-only fixed-window abuse counters; identity_hash is an HMAC, never a raw IP.';
