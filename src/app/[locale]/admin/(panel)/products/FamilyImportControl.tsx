"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getDict, type Locale } from "@/lib/i18n";
import type { ImportState } from "@/lib/catalogImport";
import { IMPORT_MAX_BYTES } from "@/lib/importLimits";
import { csvFileForUpload } from "@/lib/importUploadClient";
import { ColumnReview } from "./ColumnReview";
import { ImportFeedback } from "./ImportFeedback";

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
 */
export function FamilyImportControl({
  familyId,
  locale,
  demo,
  prominent = false,
}: {
  familyId: number;
  locale: Locale;
  demo: boolean;
  prominent?: boolean;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [state, setState] = useState<ImportState | null>(null);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  function choose(file: File | undefined) {
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

  return (
    <form onSubmit={submit} className="taxonomy-import-form">
      <div className={`taxonomy-import-controls ${prominent ? "taxonomy-import-prominent" : ""}`}>
        <label className={`btn-file ${picked ? "btn-file-set" : ""}`}>
          <input
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
      </div>

      {state?.kind === "review" && (
        <ColumnReview
          key={state.headers.map((header) => header.plan.header).join("|")}
          headers={state.headers}
          missing={state.missing}
          rowCount={state.rowCount}
          problems={state.problems}
          rowProblems={state.rowProblems}
          goodRows={state.goodRows}
          locale={locale}
          pending={pending}
        />
      )}
      {state && state.kind !== "review" && (
        <ImportFeedback state={state} locale={locale} />
      )}
    </form>
  );
}
