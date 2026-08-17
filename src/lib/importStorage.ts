import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUTH_SECRET } from "./authSecret";
import { IMPORT_MAX_BYTES } from "./importLimits";
import {
  signImportUploadClaim,
  verifyImportUploadClaim,
  type ImportUploadClaim,
} from "./importUploadToken";

const DEFAULT_BUCKET = "catalog-imports";
const TWO_HOURS = 2 * 60 * 60 * 1_000;

export class ImportStorageError extends Error {
  constructor(
    readonly problem: "not-configured" | "upload-failed" | "invalid-upload",
    message: string,
  ) {
    super(message);
    this.name = "ImportStorageError";
  }
}

type Config = {
  apiUrl: string;
  browserUrl: string;
  browserKey: string;
  secret: string;
  bucket: string;
};

function config(): Config {
  const apiUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const browserUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_PUBLIC_URL?.trim() ||
    apiUrl;
  const browserKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    "";
  const secret =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const bucket = process.env.SUPABASE_IMPORT_BUCKET?.trim() || DEFAULT_BUCKET;
  const catalogBucket = process.env.SUPABASE_CATALOG_BUCKET?.trim() || "catalog-images";

  if (!apiUrl || !browserUrl || !browserKey || !secret) {
    throw new ImportStorageError(
      "not-configured",
      "Supabase URL, publishable key, and server secret are required for catalog imports.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket) || bucket === catalogBucket) {
    throw new ImportStorageError("not-configured", "Invalid or shared import bucket name.");
  }
  try {
    new URL(apiUrl);
    new URL(browserUrl);
  } catch {
    throw new ImportStorageError("not-configured", "Invalid Supabase URL.");
  }
  return { apiUrl, browserUrl, browserKey, secret, bucket };
}

let cachedKey = "";
let cachedClient: SupabaseClient | null = null;
let readyBucket = "";
let bucketPromise: Promise<void> | null = null;

function client(storage: Config): SupabaseClient {
  const key = `${storage.apiUrl}\n${storage.secret}`;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedKey = key;
  readyBucket = "";
  bucketPromise = null;
  cachedClient = createClient(storage.apiUrl, storage.secret, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return cachedClient;
}

async function ensurePrivateBucket(supabase: SupabaseClient, bucket: string): Promise<void> {
  if (readyBucket === bucket) return;
  if (bucketPromise) return bucketPromise;

  bucketPromise = (async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    const options = {
      public: false,
      allowedMimeTypes: ["text/csv"],
      fileSizeLimit: IMPORT_MAX_BYTES,
    };
    if (data.some((item) => item.id === bucket || item.name === bucket)) {
      const { error: updateError } = await supabase.storage.updateBucket(bucket, options);
      if (updateError) throw updateError;
    } else {
      const { error: createError } = await supabase.storage.createBucket(bucket, options);
      if (createError) {
        const { data: after, error: afterError } = await supabase.storage.listBuckets();
        if (afterError || !after.some((item) => item.id === bucket || item.name === bucket)) {
          throw createError;
        }
      }
    }
    readyBucket = bucket;
  })();

  try {
    await bucketPromise;
  } finally {
    bucketPromise = null;
  }
}

/** Best-effort cleanup for a browser closed between prepare and confirm. */
async function cleanupAbandonedUploads(
  supabase: SupabaseClient,
  bucket: string,
): Promise<void> {
  try {
    const { data, error } = await supabase.storage.from(bucket).list("imports", {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) return;
    const cutoff = Date.now() - 3 * 60 * 60 * 1_000;
    const stale = data
      .filter(
        (object) =>
          object.name.endsWith(".csv") &&
          typeof object.created_at === "string" &&
          Date.parse(object.created_at) < cutoff,
      )
      .map((object) => `imports/${object.name}`);
    if (stale.length > 0) await supabase.storage.from(bucket).remove(stale);
  } catch {
    // Cleanup must never prevent a new import from starting.
  }
}

export type PreparedImportUpload = {
  browserUrl: string;
  browserKey: string;
  bucket: string;
  path: string;
  storageToken: string;
  handle: string;
};

export async function prepareImportUpload(
  familyId: number,
  bytes: number,
): Promise<PreparedImportUpload> {
  if (!Number.isSafeInteger(familyId) || familyId <= 0) {
    throw new ImportStorageError("invalid-upload", "Invalid family id.");
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > IMPORT_MAX_BYTES) {
    throw new ImportStorageError("invalid-upload", "Invalid import size.");
  }

  try {
    const storage = config();
    const supabase = client(storage);
    await ensurePrivateBucket(supabase, storage.bucket);
    await cleanupAbandonedUploads(supabase, storage.bucket);
    const day = new Date().toISOString().slice(0, 10);
    const path = `imports/${day}_${randomUUID()}.csv`;
    const { data, error } = await supabase.storage
      .from(storage.bucket)
      .createSignedUploadUrl(path);
    if (error || !data?.token) throw error ?? new Error("No signed upload token returned");

    const claim: ImportUploadClaim = {
      familyId,
      path,
      bytes,
      expiresAt: Date.now() + TWO_HOURS,
    };
    return {
      browserUrl: storage.browserUrl,
      browserKey: storage.browserKey,
      bucket: storage.bucket,
      path,
      storageToken: data.token,
      handle: signImportUploadClaim(claim, AUTH_SECRET),
    };
  } catch (error) {
    if (error instanceof ImportStorageError) throw error;
    throw new ImportStorageError(
      "upload-failed",
      error instanceof Error ? error.message : "Could not prepare catalog import upload.",
    );
  }
}

export async function downloadImportUpload(
  handle: string,
): Promise<{ claim: ImportUploadClaim; text: string }> {
  const claim = verifyImportUploadClaim(handle, AUTH_SECRET);
  if (!claim || claim.bytes > IMPORT_MAX_BYTES) {
    throw new ImportStorageError("invalid-upload", "Invalid or expired import upload.");
  }

  try {
    const storage = config();
    const { data, error } = await client(storage).storage.from(storage.bucket).download(claim.path);
    if (error || !data) throw error ?? new Error("Import object was not found");
    if (data.size !== claim.bytes || data.size > IMPORT_MAX_BYTES) {
      throw new ImportStorageError("invalid-upload", "Uploaded CSV size does not match its claim.");
    }
    return { claim, text: await data.text() };
  } catch (error) {
    if (error instanceof ImportStorageError) throw error;
    throw new ImportStorageError(
      "upload-failed",
      error instanceof Error ? error.message : "Could not read catalog import upload.",
    );
  }
}

export async function removeImportUpload(path: string): Promise<void> {
  const storage = config();
  const { error } = await client(storage).storage.from(storage.bucket).remove([path]);
  if (error) throw new ImportStorageError("upload-failed", error.message);
}
