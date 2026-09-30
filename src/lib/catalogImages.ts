/** Shared rules for catalog artwork, used by both CSV import and file upload. */

// Leaves room for multipart framing under Vercel's 4.5 MB Function payload cap.
export const CATALOG_IMAGE_MAX_BYTES = 4_000_000;

export const CATALOG_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CatalogImageMime = (typeof CATALOG_IMAGE_MIME_TYPES)[number];

const MIME_SET = new Set<string>(CATALOG_IMAGE_MIME_TYPES);

/**
 * Normalise a remote image URL without allowing script, data, or local-file
 * schemes into an `<img src>`. An empty value is valid and represented by "".
 */
export function normalizeCatalogImageUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const STORAGE_PUBLIC_PATH = "/storage/v1/object/public/";

/**
 * Whether an image may go through Next's optimiser: only our own public
 * Storage objects — hosted Supabase, or the self-hosted Storage host the build
 * was given. The optimiser fetches whatever it is allowed to, and each image
 * and size is billed, so allowing every HTTPS host made `/_next/image` an open
 * proxy for anyone on the internet, not only for admins (review M-5). Anything
 * else — a supplier URL an admin pasted — is served as it is.
 */
export function optimizableImageUrl(raw: string, storageHost: string | undefined): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.pathname.startsWith(STORAGE_PUBLIC_PATH)) return false;
    return url.hostname.endsWith(".supabase.co") || (Boolean(storageHost) && url.hostname === storageHost);
  } catch {
    return false;
  }
}

export type CatalogImageFileProblem = "file-type" | "file-too-large";

/** Metadata validation happens before any bytes are sent to object storage. */
export function catalogImageFileProblem(file: {
  type: string;
  size: number;
}): CatalogImageFileProblem | null {
  if (!MIME_SET.has(file.type)) return "file-type";
  if (file.size > CATALOG_IMAGE_MAX_BYTES) return "file-too-large";
  return null;
}

export function catalogImageExtension(type: CatalogImageMime): "jpg" | "png" | "webp" {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "webp";
}

export function isCatalogImageMime(type: string): type is CatalogImageMime {
  return MIME_SET.has(type);
}
