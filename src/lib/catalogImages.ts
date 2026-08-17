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
