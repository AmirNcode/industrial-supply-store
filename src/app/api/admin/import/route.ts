import { NextResponse } from "next/server";
import { assertAdminWrite } from "@/lib/admin";
import { processCatalogImport } from "@/lib/catalogImport";
import { getFamilyForImport } from "@/db/importQueries";
import {
  ImportStorageError,
  downloadImportUpload,
  prepareImportUpload,
  removeImportUpload,
} from "@/lib/importStorage";
import { IMPORT_MAX_BYTES } from "@/lib/importLimits";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import {
  REQUEST_LIMITS,
  RequestBodyTooLargeError,
  boundedString,
  readJsonWithin,
} from "@/lib/requestLimits";

const NO_STORE = { "cache-control": "no-store" };

function sameOrigin(request: Request): boolean {
  const submitted = request.headers.get("origin");
  if (!submitted) return false;
  try {
    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      new URL(request.url).host;
    return new URL(submitted).host === host;
  } catch {
    return false;
  }
}

function storageFailure(error: unknown, familyId: number) {
  const message =
    error instanceof ImportStorageError && error.problem === "not-configured"
      ? "storage-missing"
      : "upload-failed";
  return NextResponse.json(
    { state: { kind: "message", familyId, message } },
    { status: error instanceof ImportStorageError && error.problem === "invalid-upload" ? 400 : 503, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "cross-origin request" }, { status: 403, headers: NO_STORE });
  }
  try {
    await assertAdminWrite();
  } catch {
    return NextResponse.json({ error: "not authorized" }, { status: 403, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await readJsonWithin(request, REQUEST_LIMITS.importerControlBytes);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "body too large" : "invalid json" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: NO_STORE },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid request" }, { status: 400, headers: NO_STORE });
  }

  const input = body as Record<string, unknown>;
  const familyId = Number(input.familyId);

  if (input.kind === "prepare") {
    const limit = await consumeRateLimit("admin:import:prepare", RATE_LIMITS.importPrepare, {
      headers: request.headers,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { state: { kind: "message", familyId, message: "rate-limit" } },
        { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter) } },
      );
    }

    const fileName = boundedString(input.fileName, 255);
    const bytes = Number(input.bytes);
    if (
      !Number.isSafeInteger(familyId) ||
      familyId <= 0 ||
      !fileName?.toLowerCase().endsWith(".csv") ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > IMPORT_MAX_BYTES ||
      !(await getFamilyForImport(familyId))
    ) {
      return NextResponse.json(
        { state: { kind: "message", familyId, message: bytes > IMPORT_MAX_BYTES ? "too-large" : "not-found" } },
        { status: 400, headers: NO_STORE },
      );
    }
    try {
      return NextResponse.json(
        { upload: await prepareImportUpload(familyId, bytes) },
        { headers: NO_STORE },
      );
    } catch (error) {
      return storageFailure(error, familyId);
    }
  }

  if (input.kind === "process") {
    const limit = await consumeRateLimit("admin:import:process", RATE_LIMITS.importProcess, {
      headers: request.headers,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { state: { kind: "message", familyId, message: "rate-limit" } },
        { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter) } },
      );
    }

    const handle = boundedString(input.handle, 2_000);
    const stage = input.stage === "apply" ? "apply" : input.stage === "review" ? "review" : null;
    const plan =
      input.plan === undefined
        ? undefined
        : boundedString(input.plan, REQUEST_LIMITS.importerControlBytes, { allowEmpty: true });
    if (!handle || !stage || (input.plan !== undefined && plan === null)) {
      return NextResponse.json({ error: "invalid request" }, { status: 400, headers: NO_STORE });
    }

    try {
      const upload = await downloadImportUpload(handle);
      if (familyId !== upload.claim.familyId) {
        return NextResponse.json({ error: "invalid request" }, { status: 400, headers: NO_STORE });
      }
      const state = await processCatalogImport({
        familyId: upload.claim.familyId,
        text: upload.text,
        stage,
        rawPlan: plan,
      });
      if (state.kind !== "review") {
        // A failed cleanup must not turn a successful catalog transaction into
        // a false failure. The object remains private, the signed handles
        // expire after two hours, and the next prepare call sweeps stale files.
        try {
          await removeImportUpload(upload.claim.path);
        } catch {
          // Best effort; never expose storage internals in the admin response.
        }
      }
      return NextResponse.json({ state }, { headers: NO_STORE });
    } catch (error) {
      return storageFailure(error, familyId);
    }
  }

  return NextResponse.json({ error: "invalid request" }, { status: 400, headers: NO_STORE });
}

export const maxDuration = 300;
