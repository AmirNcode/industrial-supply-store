import "server-only";

const DEFAULT_IMPORT_BUCKET = "catalog-imports";
const DEFAULT_CATALOG_BUCKET = "catalog-images";

export type ImportStorageProblem = "not-configured" | "upload-failed" | "invalid-upload";

export class ImportStorageError extends Error {
  constructor(
    readonly problem: ImportStorageProblem,
    message: string,
  ) {
    super(message);
    this.name = "ImportStorageError";
  }
}

export type ImportStorageConfig = {
  apiUrl: string;
  browserUrl: string;
  browserKey: string;
  secret: string;
  bucket: string;
};

type LegacyKeyClaims = {
  ref?: string;
  role?: string;
};

function url(value: string): URL {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed;
  } catch {
    throw new ImportStorageError("not-configured", "Invalid Supabase URL.");
  }
}

/** Hosted project URLs carry the project ref in the first hostname label. */
function hostedProjectRef(value: URL): string | null {
  return value.hostname.toLowerCase().match(/^([a-z0-9]+)\.supabase\.(?:co|in|red)$/)?.[1] ?? null;
}

/**
 * Legacy anon/service-role keys are JWTs whose public payload identifies their
 * project and role. This is configuration validation only, never authorization.
 */
function legacyKeyClaims(key: string): LegacyKeyClaims | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const claims = parsed as Record<string, unknown>;
    return {
      ref: typeof claims.ref === "string" ? claims.ref : undefined,
      role: typeof claims.role === "string" ? claims.role : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve only runtime server variables.
 *
 * The route returns the selected publishable key to the browser for one signed
 * upload. `NEXT_PUBLIC_*` variables are deliberately ignored: Next freezes
 * them at build time, which can pair an old project URL with a current server
 * secret after a deployment is promoted or an integration is replaced.
 */
export function resolveImportStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ImportStorageConfig {
  const apiUrl = environment.SUPABASE_URL?.trim() ?? "";
  const browserUrl = environment.SUPABASE_PUBLIC_URL?.trim() || apiUrl;
  const browserKey =
    environment.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    environment.SUPABASE_ANON_KEY?.trim() ||
    "";
  const secret =
    environment.SUPABASE_SECRET_KEY?.trim() ||
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const bucket = environment.SUPABASE_IMPORT_BUCKET?.trim() || DEFAULT_IMPORT_BUCKET;
  const catalogBucket = environment.SUPABASE_CATALOG_BUCKET?.trim() || DEFAULT_CATALOG_BUCKET;

  if (!apiUrl || !browserUrl || !browserKey || !secret) {
    throw new ImportStorageError(
      "not-configured",
      "Supabase URL, publishable key, and server secret are required for catalog imports.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket) || bucket === catalogBucket) {
    throw new ImportStorageError("not-configured", "Invalid or shared import bucket name.");
  }

  const api = url(apiUrl);
  const browser = url(browserUrl);
  const apiRef = hostedProjectRef(api);
  const browserRef = hostedProjectRef(browser);
  if (apiRef && browserRef && apiRef !== browserRef) {
    throw new ImportStorageError(
      "not-configured",
      "Server and browser URLs target different hosted Supabase projects.",
    );
  }

  const claims = legacyKeyClaims(browserKey);
  if (browserKey.startsWith("sb_secret_") || (claims?.role && claims.role !== "anon")) {
    throw new ImportStorageError(
      "not-configured",
      "A publishable or legacy anon key is required for browser uploads.",
    );
  }
  if (browserRef && claims?.ref && browserRef !== claims.ref) {
    throw new ImportStorageError(
      "not-configured",
      "Browser URL and legacy anon key target different Supabase projects.",
    );
  }

  return { apiUrl, browserUrl, browserKey, secret, bucket };
}
