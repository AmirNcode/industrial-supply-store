import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PROOF_MAX_BYTES, PROOF_TYPES, proofExtension, type ProofType } from "./paymentProof";

const DEFAULT_BUCKET = "payment-proofs";

/**
 * Receipts live in a private bucket, never a public one.
 *
 * A bank receipt carries a customer's name, card digits and amounts. The
 * bucket is created private by the app itself on first use, and nothing links
 * to it: every read goes through `/api/payment-proofs/[id]`, which checks who
 * is asking, and streams the bytes. There is no public URL to leak.
 */
export class ProofStorageError extends Error {
  constructor(readonly problem: "not-configured" | "failed", message: string) {
    super(message);
    this.name = "ProofStorageError";
  }
}

type Config = { apiUrl: string; secret: string; bucket: string };

function config(): Config {
  const apiUrl = process.env.SUPABASE_URL?.trim() ?? "";
  // Same pair the catalog and import storage accept: hosted projects' newer
  // secret key, or a self-hosted stack's legacy service-role JWT.
  const secret =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const bucket = process.env.SUPABASE_PAYMENT_PROOF_BUCKET?.trim() || DEFAULT_BUCKET;
  if (!apiUrl || !secret) {
    throw new ProofStorageError("not-configured", "SUPABASE_URL and a server-side secret are required.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/i.test(bucket)) {
    throw new ProofStorageError("not-configured", "Invalid payment proof bucket name.");
  }
  return { apiUrl, secret, bucket };
}

let clientKey = "";
let client: SupabaseClient | null = null;
let readyBucket = "";
let bucketPromise: Promise<void> | null = null;

function storageClient(c: Config): SupabaseClient {
  const key = `${c.apiUrl}\n${c.secret}`;
  if (client && clientKey === key) return client;
  clientKey = key;
  readyBucket = "";
  bucketPromise = null;
  client = createClient(c.apiUrl, c.secret, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return client;
}

async function ensurePrivateBucket(supabase: SupabaseClient, bucket: string): Promise<void> {
  if (readyBucket === bucket) return;
  if (bucketPromise) return bucketPromise;
  bucketPromise = (async () => {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    // Re-applied every cold start, so a bucket someone made public by hand in
    // the dashboard is made private again rather than trusted.
    const options = {
      public: false,
      allowedMimeTypes: [...PROOF_TYPES],
      fileSizeLimit: PROOF_MAX_BYTES,
    };
    if (data.some((item) => item.id === bucket || item.name === bucket)) {
      const { error: updateError } = await supabase.storage.updateBucket(bucket, options);
      if (updateError) throw updateError;
    } else {
      const { error: createError } = await supabase.storage.createBucket(bucket, options);
      if (createError) {
        // Two instances can race on the very first upload; a second list
        // proves the other one made it.
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

function failed(error: unknown): ProofStorageError {
  if (error instanceof ProofStorageError) return error;
  return new ProofStorageError("failed", error instanceof Error ? error.message : "Storage request failed.");
}

/** Stores one receipt under its order and returns the object's path. */
export async function storePaymentProof(
  orderId: number,
  bytes: Uint8Array,
  type: ProofType,
): Promise<string> {
  const c = config();
  try {
    const supabase = storageClient(c);
    await ensurePrivateBucket(supabase, c.bucket);
    const path = `orders/${orderId}/${randomUUID()}.${proofExtension(type)}`;
    const { error } = await supabase.storage.from(c.bucket).upload(path, bytes, {
      contentType: type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  } catch (error) {
    throw failed(error);
  }
}

export async function readPaymentProof(path: string): Promise<Uint8Array> {
  const c = config();
  try {
    const { data, error } = await storageClient(c).storage.from(c.bucket).download(path);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  } catch (error) {
    throw failed(error);
  }
}

/** Best effort: a file whose database row was refused should not linger. */
export async function discardPaymentProof(path: string): Promise<void> {
  try {
    const c = config();
    await storageClient(c).storage.from(c.bucket).remove([path]);
  } catch {
    // An orphaned object costs a few hundred KB and is never linked to.
  }
}
