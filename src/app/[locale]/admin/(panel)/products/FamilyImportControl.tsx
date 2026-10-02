"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getDict, type Locale } from "@/lib/i18n";
import type { ImportState } from "@/lib/catalogImport";
import { IMPORT_MAX_BYTES } from "@/lib/importLimits";
import { csvFileForUpload } from "@/lib/importUploadClient";
import { ColumnReview } from "./ColumnReview";
import { ImportFeedback } from "./ImportFeedback";
import { MobileColumnReview } from "./mobile/MobileColumnReview";

type PreparedUpload = {
  browserUrl: string;
  browserKey: string;
  bucket: string;
  path: string;
  storageToken: string;
  handle: string;
};

/**
 * The established private-object CSV flow, scoped to one family.
 *
 * Keeping this component independent lets the taxonomy pane move the same
 * control between a category row and the selected-family panel without
 * weakening any of the importer validation or review surfaces.
 *
 * The phone flow shows the same control as two large numbered buttons, with
 * the family's Template / Export / Columns links under them (`extras`). Only
 * the presentation differs; the upload, its checks and the review are one.
 */
export function FamilyImportControl({
  familyId,
  locale,
  demo,
  prominent = false,
  variant = "desktop",
  familyName = "",
  extras,
}: {
  familyId: number;
  locale: Locale;
  demo: boolean;
  prominent?: boolean;
  variant?: "desktop" | "mobile";
  /** For the phone's column check, which names the family it imports into. */
  familyName?: string;
  /** Shown under the phone's buttons, above any import result. */
  extras?: ReactNode;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [state, setState] = useState<ImportState | null>(null);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Says so after a Discard, until the next file is chosen.
  const [discarded, setDiscarded] = useState(false);

  function choose(file: File | undefined) {
    setDiscarded(false);
    setHandle(null);
    setPicked(file ?? null);
    if (!file) setState(null);
    else if (file.size > IMPORT_MAX_BYTES) {
      setState({ kind: "message", familyId, message: "too-large" });
    } else setState(null);
  }

  async function postImport(body: Record<string, unknown>): Promise<{
    upload?: PreparedUpload;
    state?: ImportState;
  }> {
    const response = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as {
      upload?: PreparedUpload;
      state?: ImportState;
    };
    if (result.state) return result;
    if (!response.ok) throw new Error("Import request failed");
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const applying = submitter?.name === "stage" && submitter.value === "apply";

    setPending(true);
    try {
      let uploadHandle = handle;
      if (!applying) {
        if (!picked) {
          setState({ kind: "message", familyId, message: "no-file" });
          return;
        }
        if (picked.size > IMPORT_MAX_BYTES) {
          setState({ kind: "message", familyId, message: "too-large" });
          return;
        }

        const prepared = await postImport({
          kind: "prepare",
          familyId,
          fileName: picked.name,
          bytes: picked.size,
        });
        if (prepared.state) {
          setState(prepared.state);
          return;
        }
        if (!prepared.upload) throw new Error("No import upload was prepared");

        const supabase = createClient(prepared.upload.browserUrl, prepared.upload.browserKey, {
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
        });
        const { error } = await supabase.storage
          .from(prepared.upload.bucket)
          .uploadToSignedUrl(
            prepared.upload.path,
            prepared.upload.storageToken,
            csvFileForUpload(picked),
            { contentType: "text/csv", cacheControl: "7200" },
          );
        if (error) {
          console.error("Catalog CSV upload failed before review.", {
            name: error.name,
            message: error.message,
          });
          setState({ kind: "message", familyId, message: "upload-failed" });
          return;
        }
        uploadHandle = prepared.upload.handle;
        setHandle(uploadHandle);
      }

      if (!uploadHandle) {
        setState({ kind: "message", familyId, message: "no-file" });
        return;
      }
      const fields = new FormData(form);
      const processed = await postImport({
        kind: "process",
        familyId,
        handle: uploadHandle,
        stage: applying ? "apply" : "review",
        plan: applying ? String(fields.get("plan") ?? "") : undefined,
      });
      if (!processed.state) throw new Error("No import result returned");
      setState(processed.state);
      if (processed.state.kind !== "review") {
        setHandle(null);
        if (processed.state.kind === "ok") router.refresh();
      }
    } catch (error) {
      console.error("Catalog CSV import request failed.", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown import error",
      });
      setState({ kind: "message", familyId, message: "upload-failed" });
    } finally {
      setPending(false);
    }
  }

  /**
   * The wrong file: forget it here, and delete the uploaded copy from import
   * storage rather than leave it for the two-hour expiry. The screen clears
   * at once; the server's answer changes nothing the admin sees, because a
   * copy the delete misses is swept on the next upload anyway.
   */
  function discard() {
    const staged = handle;
    choose(undefined);
    setDiscarded(true);
    if (fileInput.current) fileInput.current.value = "";
    if (staged) {
      fetch("/api/admin/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "discard", familyId, handle: staged }),
      }).catch(() => {
        // Best effort, as above.
      });
    }
  }

  // Before the import has run: a file chosen, uploaded, or refused.
  const canDiscard = !demo && picked !== null && state?.kind !== "ok";

  if (variant === "mobile") {
    return (
      <form onSubmit={submit} className="taxonomy-import-form mtx-import-form">
        <div className="mtx-import-buttons">
          <label className={`mtx-button mtx-ghost mtx-secondary mtx-file ${demo || pending ? "is-disabled" : ""}`}>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              disabled={demo || pending}
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <span className="mtx-step">1</span>
            <span className="mtx-file-name">{picked?.name ?? t.chooseCsv}</span>
          </label>
          <button
            type="submit"
            className={`mtx-button mtx-secondary ${picked && !demo ? "mtx-primary" : "mtx-blocked"}`}
            disabled={demo || pending || !picked}
          >
            <span className="mtx-step">2</span>
            {t.uploadCsv}
          </button>
        </div>
        {canDiscard && state?.kind !== "review" && (
          <button type="button" className="mtx-link-button" disabled={pending} onClick={discard}>
            {t.importDiscard}
          </button>
        )}
        {extras}
        {discarded && <p className="mtx-hint mtx-import-feedback">{t.importDiscarded}</p>}

        {state?.kind === "review" && (
          <MobileColumnReview
            key={JSON.stringify(state.plan)}
            initialPlan={state.plan}
            headers={state.headers}
            missing={state.missing}
            rowCount={state.rowCount}
            problems={state.problems}
            rowProblems={state.rowProblems}
            goodRows={state.goodRows}
            blankRows={state.blankRows}
            locale={locale}
            pending={pending}
            fileName={picked?.name ?? ""}
            familyName={familyName}
            onCancel={discard}
          />
        )}
        {state && state.kind !== "review" && (
          <div className="mtx-import-feedback">
            <ImportFeedback state={state} locale={locale} />
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="taxonomy-import-form">
      <div className={`taxonomy-import-controls ${prominent ? "taxonomy-import-prominent" : ""}`}>
        <label className={`btn-file ${picked ? "btn-file-set" : ""}`}>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            disabled={demo || pending}
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <span className="btn-file-step">1</span>
          <span className="btn-file-name">{picked?.name ?? t.chooseCsv}</span>
        </label>
        <button
          type="submit"
          className="btn-small btn-step"
          disabled={demo || pending || !picked}
        >
          <span className="btn-file-step">2</span>
          {t.uploadCsv}
        </button>
        {/* While reviewing, Discard sits beside Confirm instead. */}
        {canDiscard && state?.kind !== "review" && (
          <button type="button" className="btn-small" disabled={pending} onClick={discard}>
            {t.importDiscard}
          </button>
        )}
      </div>
      {discarded && (
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.importDiscarded}</p>
      )}

      {state?.kind === "review" && (
        <ColumnReview
          key={JSON.stringify(state.plan)}
          initialPlan={state.plan}
          headers={state.headers}
          missing={state.missing}
          rowCount={state.rowCount}
          problems={state.problems}
          rowProblems={state.rowProblems}
          goodRows={state.goodRows}
          blankRows={state.blankRows}
          locale={locale}
          pending={pending}
          onDiscard={discard}
        />
      )}
      {state && state.kind !== "review" && (
        <ImportFeedback state={state} locale={locale} />
      )}
    </form>
  );
}
