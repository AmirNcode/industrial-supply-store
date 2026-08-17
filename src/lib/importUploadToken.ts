import { createHmac, timingSafeEqual } from "node:crypto";

export type ImportUploadClaim = {
  familyId: number;
  path: string;
  bytes: number;
  expiresAt: number;
};

const VERSION = 1;
const PATH = /^imports\/\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}\.csv$/i;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`isupply-import-upload-v1\0${payload}`)
    .digest("base64url");
}

export function signImportUploadClaim(claim: ImportUploadClaim, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: VERSION, ...claim })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyImportUploadClaim(
  token: string,
  secret: string,
  now = Date.now(),
): ImportUploadClaim | null {
  if (token.length > 2_000) return null;
  const [payload, submittedSignature, extra] = token.split(".");
  if (!payload || !submittedSignature || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, secret));
  const submitted = Buffer.from(submittedSignature);
  if (expected.length !== submitted.length || !timingSafeEqual(expected, submitted)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<
      ImportUploadClaim & { v: number }
    >;
    if (
      parsed.v !== VERSION ||
      !Number.isSafeInteger(parsed.familyId) ||
      parsed.familyId! <= 0 ||
      typeof parsed.path !== "string" ||
      !PATH.test(parsed.path) ||
      !Number.isSafeInteger(parsed.bytes) ||
      parsed.bytes! <= 0 ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt! <= now
    ) {
      return null;
    }
    return {
      familyId: parsed.familyId!,
      path: parsed.path,
      bytes: parsed.bytes!,
      expiresAt: parsed.expiresAt!,
    };
  } catch {
    return null;
  }
}
