/**
 * Explicit ceilings for data that reaches a public query or mutation.
 *
 * Next/Vercel impose transport limits, but those are deliberately not the
 * application contract: a 4 MB request can still contain hundreds of
 * thousands of tiny values, and a short query string can still expand into
 * dozens of database predicates. Keep the semantic limits here so Route
 * Handlers, Server Actions, and their tests all use the same numbers.
 */
export const REQUEST_LIMITS = {
  routeJsonBytes: 8 * 1024,
  importerControlBytes: 128 * 1024,
  quickOrderBytes: 32 * 1024,
  quickOrderLines: 200,
  cartLines: 250,
  suggestionChars: 80,
  searchChars: 160,
  filterKeys: 12,
  filterValuesPerKey: 20,
  filterValuesTotal: 60,
  filterKeyChars: 64,
  filterValueChars: 200,
  emailChars: 254,
  passwordChars: 256,
  companyChars: 160,
  contactNameChars: 160,
  phoneChars: 64,
  poNumberChars: 100,
  addressChars: 500,
  cityChars: 120,
  countryChars: 120,
  notesChars: 4_000,
} as const;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** A string inside its field ceiling, or null when the submitted value is not usable. */
export function boundedString(
  value: unknown,
  maxChars: number,
  options: { trim?: boolean; allowEmpty?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;
  const result = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && result.length === 0) return null;
  if (result.length > maxChars) return null;
  return result;
}

export type QuickOrderLine = { partNumber: string; qty: number };

export type QuickOrderParseResult =
  | { ok: true; lines: QuickOrderLine[] }
  | { ok: false; reason: "too-large" };

/**
 * Parse the buyer-friendly spreadsheet format without allowing one post to
 * turn into an unbounded lookup or write loop.
 */
export function parseQuickOrder(value: unknown): QuickOrderParseResult {
  if (typeof value !== "string") return { ok: true, lines: [] };
  if (utf8ByteLength(value) > REQUEST_LIMITS.quickOrderBytes) {
    return { ok: false, reason: "too-large" };
  }

  const sourceLines = value.split(/\r?\n/);
  if (sourceLines.length > REQUEST_LIMITS.quickOrderLines) {
    return { ok: false, reason: "too-large" };
  }

  const lines: QuickOrderLine[] = [];
  for (const source of sourceLines) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    const parts = trimmed
      .split(/[,\t]+|\s{2,}|\s+(?=\d+$)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const partNumber = boundedString(parts[0], 120);
    if (!partNumber) continue;
    const parsedQty = Number(parts[1]);
    const qty = Number.isFinite(parsedQty)
      ? Math.max(1, Math.min(99_999, Math.trunc(parsedQty)))
      : 1;
    lines.push({ partNumber, qty });
  }

  return { ok: true, lines };
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Read a body incrementally. `request.json()` buffers before application code
 * can reject a chunked request, so checking Content-Length alone is not a
 * resource boundary.
 */
export async function readTextBodyWithin(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function readJsonWithin(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readTextBodyWithin(request, maxBytes));
}
