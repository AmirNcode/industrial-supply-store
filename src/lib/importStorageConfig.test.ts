import assert from "node:assert/strict";
import { test } from "node:test";
import { ImportStorageError, resolveImportStorageConfig } from "./importStorageConfig";

function legacyKey(ref: string, role = "anon"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ref, role })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://currentproject.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_current",
  SUPABASE_SECRET_KEY: "sb_secret_server_only",
};

test("import storage uses runtime variables and ignores stale NEXT_PUBLIC values", () => {
  const config = resolveImportStorageConfig({
    ...BASE,
    NEXT_PUBLIC_SUPABASE_URL: "https://retiredproject.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_retired",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("retiredproject"),
  });

  assert.equal(config.apiUrl, BASE.SUPABASE_URL);
  assert.equal(config.browserUrl, BASE.SUPABASE_URL);
  assert.equal(config.browserKey, BASE.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(config.bucket, "catalog-imports");
});

test("an explicit public URL supports a self-hosted internal API hostname", () => {
  const config = resolveImportStorageConfig({
    ...BASE,
    SUPABASE_URL: "http://supabase-kong:8000",
    SUPABASE_PUBLIC_URL: "https://storage.example.com",
  });

  assert.equal(config.apiUrl, "http://supabase-kong:8000");
  assert.equal(config.browserUrl, "https://storage.example.com");
});

test("different hosted server and browser projects are refused", () => {
  assert.throws(
    () =>
      resolveImportStorageConfig({
        ...BASE,
        SUPABASE_PUBLIC_URL: "https://retiredproject.supabase.co",
      }),
    (error: unknown) =>
      error instanceof ImportStorageError &&
      error.problem === "not-configured" &&
      /different hosted Supabase projects/.test(error.message),
  );
});

test("a legacy anon key must belong to the browser project", () => {
  assert.throws(
    () =>
      resolveImportStorageConfig({
        ...BASE,
        SUPABASE_PUBLISHABLE_KEY: "",
        SUPABASE_ANON_KEY: legacyKey("retiredproject"),
      }),
    (error: unknown) =>
      error instanceof ImportStorageError && /legacy anon key target different/.test(error.message),
  );
});

test("a privileged key is never accepted as the browser key", () => {
  for (const key of ["sb_secret_wrong-side", legacyKey("currentproject", "service_role")]) {
    assert.throws(
      () =>
        resolveImportStorageConfig({
          ...BASE,
          SUPABASE_PUBLISHABLE_KEY: key,
        }),
      (error: unknown) =>
        error instanceof ImportStorageError && /publishable or legacy anon key/.test(error.message),
    );
  }
});

test("the private import bucket cannot share the public catalog bucket", () => {
  assert.throws(
    () =>
      resolveImportStorageConfig({
        ...BASE,
        SUPABASE_IMPORT_BUCKET: "catalog-images",
        SUPABASE_CATALOG_BUCKET: "catalog-images",
      }),
    (error: unknown) =>
      error instanceof ImportStorageError && /Invalid or shared import bucket/.test(error.message),
  );
});
