import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CATALOG_IMAGE_MIME_TYPES,
  catalogImageExtension,
  isCatalogImageMime,
} from "./catalogImages";

const DEFAULT_BUCKET = "catalog-images";

export type CatalogStorageProblem = "not-configured" | "upload-failed";

export class CatalogStorageError extends Error {
  constructor(
    readonly problem: CatalogStorageProblem,
    message: string,
  ) {
    super(message);
    this.name = "CatalogStorageError";
  }
}

type StorageConfig = {
  apiUrl: string;
  publicUrl: string;
  secret: string;
  bucket: string;
};

function storageConfig(): StorageConfig {
  const apiUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const publicUrl = process.env.SUPABASE_PUBLIC_URL?.trim() || apiUrl;
  // Hosted projects can use the newer secret key; self-hosted installations
  // commonly still expose the legacy service-role JWT. Both remain server-only.
  const secret =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const bucket = process.env.SUPABASE_CATALOG_BUCKET?.trim() || DEFAULT_BUCKET;

  if (!apiUrl || !publicUrl || !secret) {
    throw new CatalogStorageError(
      "not-configured",
      "SUPABASE_URL and a server-side Supabase secret are required.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket)) {
    throw new CatalogStorageError("not-configured", "Invalid catalog image bucket name.");
  }

  try {
    new URL(apiUrl);
    new URL(publicUrl);
  } catch {
    throw new CatalogStorageError("not-configured", "Invalid Supabase URL.");
  }

  return { apiUrl, publicUrl, secret, bucket };
}

let clientKey = "";
let client: SupabaseClient | null = null;
let readyBucket = "";
let bucketPromise: Promise<void> | null = null;

function storageClient(config: StorageConfig): SupabaseClient {
  const key = `${config.apiUrl}\n${config.secret}`;
  if (client && clientKey === key) return client;
  clientKey = key;
  readyBucket = "";
  bucketPromise = null;
  client = createClient(config.apiUrl, config.secret, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return client;
}

async function ensurePublicBucket(
  supabase: SupabaseClient,
  bucket: string,
): Promise<void> {
  if (readyBucket === bucket) return;
  if (bucketPromise) return bucketPromise;

  bucketPromise = (async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const options = {
      public: true,
      allowedMimeTypes: [...CATALOG_IMAGE_MIME_TYPES],
      fileSizeLimit: "5MB",
    };

    if (data.some((item) => item.id === bucket || item.name === bucket)) {
      const { error: updateError } = await supabase.storage.updateBucket(bucket, options);
      if (updateError) throw updateError;
    } else {
      const { error: createError } = await supabase.storage.createBucket(bucket, options);
      if (createError) {
        // Two app instances can race on the very first upload. If the other one
        // created it, a second list proves the desired end state was reached.
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

function publicObjectUrl(config: StorageConfig, path: string): string {
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  const bucket = encodeURIComponent(config.bucket);
  return new URL(
    `/storage/v1/object/public/${bucket}/${objectPath}`,
    config.publicUrl.endsWith("/") ? config.publicUrl : `${config.publicUrl}/`,
  ).toString();
}

/**
 * Upload immutable category/family artwork and return its browser-facing URL.
 * A separate public base supports Docker networks where the server reaches
 * Supabase by an internal hostname but customers reach it through a proxy.
 */
export async function uploadCatalogImage(
  entity: "category" | "family",
  id: number,
  file: File,
): Promise<string> {
  const config = storageConfig();
  if (!isCatalogImageMime(file.type)) {
    throw new CatalogStorageError("upload-failed", "Unsupported image MIME type.");
  }

  try {
    const supabase = storageClient(config);
    await ensurePublicBucket(supabase, config.bucket);

    const folder = entity === "category" ? "categories" : "families";
    const path = `${folder}/${id}/${randomUUID()}.${catalogImageExtension(file.type)}`;
    const body = new Uint8Array(await file.arrayBuffer());
    const { error } = await supabase.storage.from(config.bucket).upload(path, body, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return publicObjectUrl(config, path);
  } catch (error) {
    if (error instanceof CatalogStorageError) throw error;
    throw new CatalogStorageError(
      "upload-failed",
      error instanceof Error ? error.message : "Catalog image upload failed.",
    );
  }
}
