"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { saveFamilyOrderAction } from "./actions";
import type { ImportState } from "@/lib/catalogImport";
import { IMPORT_MAX_BYTES } from "@/lib/importLimits";
import { csvFileForUpload } from "@/lib/importUploadClient";
import { ColumnReview } from "./ColumnReview";
import { DeleteControl } from "./DeleteControl";
import { UnsavedOrderGuard } from "./UnsavedOrderGuard";
import type { FamilyListRow } from "@/db/importQueries";

/**
 * One import state for the whole page rather than one per family.
 *
 * CSV bytes go directly from the browser to a private Supabase Storage object
 * using a short-lived signed URL. Only small prepare/process JSON requests hit
 * the Next.js function, so the import keeps its 24 MB ceiling without raising
 * the Server Action body limit for every form in the application.
 */

/** A long file can fail on thousands of rows; the first screenful is what
 *  someone acts on, and rendering all of them would lock the tab. */
const MAX_SHOWN = 200;

export function ImportPanel({
  families,
  locale,
  demo,
}: {
  families: FamilyListRow[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, setState] = useState<ImportState | null>(null);
  const [isPending, setImportPending] = useState(false);
  const [uploadHandle, setUploadHandle] = useState<{
    familyId: number;
    handle: string;
  } | null>(null);

  /**
   * The chosen browser File, never a 24 MB string mirrored into a hidden input.
   * One at a time: only one upload can be in flight, and the private object is
   * deleted after a terminal result.
   */
  const [picked, setPicked] = useState<
    { familyId: number; name: string; file: File } | null
  >(null);

  function pick(familyId: number, file: File | undefined) {
    setUploadHandle(null);
    if (!file) {
      setPicked(null);
      return;
    }
    setPicked({ familyId, name: file.name, file });
    if (file.size > IMPORT_MAX_BYTES) {
      setState({ kind: "message", familyId, message: "too-large" });
    } else {
      setState(null);
    }
  }

  type Prepared = {
    browserUrl: string;
    browserKey: string;
    bucket: string;
    path: string;
    storageToken: string;
    handle: string;
  };

  async function postImport(body: Record<string, unknown>): Promise<{
    upload?: Prepared;
    state?: ImportState;
  }> {
    const response = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as {
      upload?: Prepared;
      state?: ImportState;
    };
    if (result.state) return result;
    if (!response.ok) throw new Error("Import request failed");
    return result;
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const applying = submitter?.name === "stage" && submitter.value === "apply";
    const familyId = Number(new FormData(form).get("familyId"));

    setImportPending(true);
    try {
      let handle = uploadHandle?.familyId === familyId ? uploadHandle.handle : null;
      if (!applying) {
        const selected = picked?.familyId === familyId ? picked.file : null;
        if (!selected) {
          setState({ kind: "message", familyId, message: "no-file" });
          return;
        }
        if (selected.size > IMPORT_MAX_BYTES) {
          setState({ kind: "message", familyId, message: "too-large" });
          return;
        }

        const prepared = await postImport({
          kind: "prepare",
          familyId,
          fileName: selected.name,
          bytes: selected.size,
        });
        if (prepared.state) {
          setState(prepared.state);
          return;
        }
        if (!prepared.upload) throw new Error("No import upload was prepared");

        const supabase = createClient(prepared.upload.browserUrl, prepared.upload.browserKey, {
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
        });
        const uploadFile = csvFileForUpload(selected);
        const { error } = await supabase.storage
          .from(prepared.upload.bucket)
          .uploadToSignedUrl(
            prepared.upload.path,
            prepared.upload.storageToken,
            uploadFile,
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
        handle = prepared.upload.handle;
        setUploadHandle({ familyId, handle });
      }

      if (!handle) {
        setState({ kind: "message", familyId, message: "no-file" });
        return;
      }
      const fields = new FormData(form);
      const processed = await postImport({
        kind: "process",
        familyId,
        handle,
        stage: applying ? "apply" : "review",
        plan: applying ? String(fields.get("plan") ?? "") : undefined,
      });
      if (!processed.state) throw new Error("No import result returned");
      setState(processed.state);
      if (processed.state.kind !== "review") setUploadHandle(null);
    } catch (error) {
      console.error("Catalog CSV import request failed.", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown import error",
      });
      setState({ kind: "message", familyId, message: "upload-failed" });
    } finally {
      setImportPending(false);
    }
  }

  /*
   * Catalog order while it is being arranged, by category: the family ids in
   * the order the operator has put them in, held here until Save.
   *
   * Only categories that have actually been touched get an entry, so this is a
   * handful of ids rather than a shadow copy of a hundred-family page — and a
   * category whose entry is gone is, by definition, unchanged. Moving a family
   * back where it started deletes the entry rather than leaving the group
   * marked dirty for an arrangement identical to the database's.
   */
  const [arranged, setArranged] = useState<Record<number, number[]>>({});
  const [orderSaving, startOrderSave] = useTransition();
  /** Categories whose last save was refused; cleared when they are touched. */
  const [orderFailed, setOrderFailed] = useState<number[]>([]);

  const groups: { id: number; name: string; families: FamilyListRow[] }[] = [];
  for (const f of families) {
    const name = locale === "fa" ? f.categoryNameFa : f.categoryNameEn;
    const last = groups[groups.length - 1];
    if (last && last.id === f.categoryId) last.families.push(f);
    else groups.push({ id: f.categoryId, name, families: [f] });
  }

  /** What the database currently holds, kept before any arrangement is laid over it. */
  const serverOrder = new Map(groups.map((g) => [g.id, g.families.map((f) => f.id)]));

  /*
   * The arrangement is applied over the server's list rather than replacing
   * it, and only ids the category still holds are honoured. If a family was
   * deleted in another tab while this page sat open, the stale id drops out
   * here and the save is refused server-side rather than writing a partial
   * order from a list that no longer describes the category.
   */
  for (const g of groups) {
    const order = arranged[g.id];
    if (!order) continue;
    const byId = new Map(g.families.map((f) => [f.id, f]));
    const rearranged = order.map((id) => byId.get(id)).filter((f) => f !== undefined);
    if (rearranged.length === g.families.length) g.families = rearranged;
  }

  function move(categoryId: number, families: FamilyListRow[], from: number, by: number) {
    const to = from + by;
    if (to < 0 || to >= families.length) return;

    const next = families.map((f) => f.id);
    [next[from], next[to]] = [next[to], next[from]];

    const server = serverOrder.get(categoryId);
    const backWhereItStarted =
      server !== undefined && server.length === next.length && server.every((id, i) => id === next[i]);

    setOrderFailed((prev) => prev.filter((id) => id !== categoryId));
    setArranged((prev) => {
      const updated = { ...prev };
      // Arranging a category back into the order it already had is not a
      // change, so Save and Discard go away again rather than offering to
      // write what is already there.
      if (backWhereItStarted) delete updated[categoryId];
      else updated[categoryId] = next;
      return updated;
    });
  }

  const discard = (categoryId: number) =>
    setArranged((prev) => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });

  async function saveOrder(categoryId: number): Promise<boolean> {
    const order = arranged[categoryId];
    if (!order) return true;
    try {
      const result = await saveFamilyOrderAction(categoryId, order);
      if (result !== "saved") {
        setOrderFailed((prev) => (prev.includes(categoryId) ? prev : [...prev, categoryId]));
        return false;
      }
      discard(categoryId);
      return true;
    } catch {
      // `assertAdminWrite` throws on an expired session. Without this the
      // rejection escapes the transition and takes the whole panel down with
      // it, losing every other category's arrangement as well.
      setOrderFailed((prev) => (prev.includes(categoryId) ? prev : [...prev, categoryId]));
      return false;
    }
  }

  const dirtyIds = Object.keys(arranged).map(Number);

  return (
    <div className="grid gap-2">
      <UnsavedOrderGuard
        dirtyCount={dirtyIds.length}
        locale={locale}
        onSave={async () => {
          const results = await Promise.all(dirtyIds.map((id) => saveOrder(id)));
          return results.every(Boolean);
        }}
        onDiscard={() => setArranged({})}
      />
      {groups.map((g) => {
        /*
         * Force the group open when it holds the family being worked on.
         *
         * `undefined` rather than `false` for every other group: React then
         * leaves the attribute alone after the first render, so a group the
         * operator opened by hand stays open when an upload elsewhere on the
         * page re-renders it. Passing `false` would make every re-render a
         * chance to snap it shut.
         */
        const active = state !== null && g.families.some((f) => f.id === state.familyId);
        const products = g.families.reduce((n, f) => n + f.productCount, 0);
        const ordered = g.families.reduce((n, f) => n + f.orderedProducts, 0);

        return (
        <details key={g.id} className="admin-group" open={active || undefined}>
          <summary className="flex cursor-pointer items-center gap-2 border-b border-[var(--color-rule)] pb-0.5 text-[13px] font-bold">
            <span>{g.name}</span>
            <Link
              className="text-[11px] font-normal"
              href={`/${locale}/admin/products/categories/${g.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              {t.editCategory}
            </Link>
            {!g.families[0]?.categoryIsVisible && (
              <span className="pill pill-muted font-normal">{t.catalogHidden}</span>
            )}
            {/* Collapsed is the default, so the heading has to carry enough to
                choose a category without opening every one of them. */}
            <span className="tech text-[11px] font-normal text-[var(--color-ink-muted)]">
              {formatInt(g.families.length, locale)} · {formatInt(products, locale)}
            </span>
            {/* Inside the summary but outside its toggle: a click on these
                controls must not also collapse the group it belongs to. That
                cancelled click is also why the order buttons are plain buttons
                calling the action directly — a cancelled click never submits a
                form. */}
            <span
              className="ms-auto flex items-center gap-1.5 font-normal"
              onClick={(e) => e.preventDefault()}
            >
              {/* Only while this category is actually rearranged, and ahead of
                  Delete: the two buttons that resolve pending work should not
                  sit past the one that destroys it. */}
              {arranged[g.id] && (
                <>
                  <button
                    type="button"
                    className="btn-tiny"
                    disabled={demo || orderSaving}
                    onClick={() =>
                      startOrderSave(async () => {
                        await saveOrder(g.id);
                      })
                    }
                  >
                    {t.orderSave}
                  </button>
                  <button
                    type="button"
                    className="btn-tiny"
                    disabled={orderSaving}
                    onClick={() => discard(g.id)}
                  >
                    {t.orderDiscard}
                  </button>
                </>
              )}
              <DeleteControl
                what="category"
                id={g.id}
                name={g.name}
                families={g.families.length}
                products={products}
                ordered={ordered}
                locale={locale}
                demo={demo}
              />
            </span>
          </summary>

          {orderFailed.includes(g.id) && (
            <p className="mt-1 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
              {t.orderFailed}
            </p>
          )}
          <div className="mt-1 grid gap-1">
            {g.families.map((f, i) => {
              const chosen = picked?.familyId === f.id ? picked.name : null;
              return (
              <div key={f.id} className="border-b border-[var(--color-rule-light)] py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className="font-semibold">
                    {locale === "fa" ? f.nameFa : f.nameEn}
                  </span>
                  <span className="tech text-[11px] text-[var(--color-ink-muted)]">
                    {formatInt(f.productCount, locale)}
                  </span>
                  {/* Stock at a glance, in the same packs as every order line.
                      On-hold and sold are only shown when non-zero so a family
                      nobody has ordered stays quiet. */}
                  <span className="text-[11px] text-[var(--color-ink-muted)]">
                    {t.stockAvailable}:{" "}
                    <span className="tech font-semibold">
                      {formatInt(f.inventoryAvailable, locale)}
                    </span>
                    {f.inventoryOnHold > 0 && (
                      <>
                        {" · "}
                        {t.stockOnHold}:{" "}
                        <span className="tech">{formatInt(f.inventoryOnHold, locale)}</span>
                      </>
                    )}
                    {f.inventorySold > 0 && (
                      <>
                        {" · "}
                        {t.stockSold}:{" "}
                        <span className="tech">{formatInt(f.inventorySold, locale)}</span>
                      </>
                    )}
                  </span>
                  <a
                    className="text-[11px]"
                    href={`/api/admin/family/${f.id}/template`}
                    download
                  >
                    {t.downloadTemplate}
                  </a>
                  <a
                    className="text-[11px]"
                    href={`/api/admin/family/${f.id}/export`}
                    download
                  >
                    {t.exportProducts}
                  </a>
                  <Link className="text-[11px]" href={`/${locale}/admin/products/${f.id}/columns`}>
                    {t.editColumns}
                  </Link>
                  <Link
                    className="text-[11px]"
                    href={`/${locale}/admin/products/categories/${g.id}#family-${f.id}`}
                  >
                    {t.editImage}
                  </Link>
                  {!f.isVisible && (
                    <span className="pill pill-muted">{t.catalogHidden}</span>
                  )}
                  <DeleteControl
                    what="family"
                    id={f.id}
                    name={locale === "fa" ? f.nameFa : f.nameEn}
                    products={f.productCount}
                    ordered={f.orderedProducts}
                    locale={locale}
                    demo={demo}
                  />

                  {/* The review panel lives inside this form so confirmation
                      carries its column plan. The CSV itself is represented by
                      a short signed handle, never reposted through Next.js. */}
                  <form onSubmit={submitImport} className="ms-auto flex flex-1 flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <input type="hidden" name="familyId" value={f.id} />
                      {/* A bare file input reads as plain text and gives no
                          hint that it comes before the button beside it, so it
                          is numbered and styled as the first of two steps. The
                          input itself is visually hidden but still focusable —
                          the label is what gets clicked.

                          Unnamed on purpose: the file is uploaded directly to
                          its short-lived private object; the form sends only
                          the small column plan through the app. */}
                      <label className={`btn-file ${chosen ? "btn-file-set" : ""}`}>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          disabled={demo}
                          onChange={(e) => pick(f.id, e.target.files?.[0])}
                        />
                        <span className="btn-file-step">1</span>
                        <span className="btn-file-name">{chosen ?? t.chooseCsv}</span>
                      </label>
                      {/* Disabled until a file is chosen, so the order of the
                          two steps is enforced rather than merely implied. */}
                      <button
                        type="submit"
                        className="btn-small btn-step"
                        disabled={demo || isPending || !chosen}
                      >
                        <span className="btn-file-step">2</span>
                        {t.uploadCsv}
                      </button>
                    </div>

                    {state?.kind === "review" && state.familyId === f.id && (
                      <div className="w-full text-start">
                        <ColumnReview
                          // Remounting per upload throws away the decisions made
                          // about the previous file, which no longer describe
                          // this one.
                          key={state.headers.map((h) => h.plan.header).join("|")}
                          headers={state.headers}
                          missing={state.missing}
                          rowCount={state.rowCount}
                          problems={state.problems}
                          rowProblems={state.rowProblems}
                          goodRows={state.goodRows}
                          locale={locale}
                          pending={isPending}
                        />
                      </div>
                    )}
                  </form>

                  {/* Catalog order, set exactly the way the column editor sets
                      it: two buttons rather than dragging, arranging a local
                      list that is written only when Save is pressed. A category
                      runs to a dozen families and the drop target for the one
                      at the bottom is off-screen; buttons also work on a phone
                      and from the keyboard without a library.

                      Nothing is written per press. Moving a family seven places
                      is one intention, and it should cost one write and one
                      cache purge, not seven of each. */}
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={i === 0 || demo || orderSaving}
                      aria-label={t.columnsMoveUp}
                      onClick={() => move(g.id, g.families, i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={i === g.families.length - 1 || demo || orderSaving}
                      aria-label={t.columnsMoveDown}
                      onClick={() => move(g.id, g.families, i, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>

                {state && state.kind !== "review" && state.familyId === f.id && (
                  <Result state={state} locale={locale} />
                )}
              </div>
              );
            })}
          </div>
        </details>
        );
      })}
    </div>
  );
}

function Result({
  state,
  locale,
}: {
  state: Exclude<ImportState, { kind: "review" }>;
  locale: Locale;
}) {
  const t = getDict(locale);

  if (state.kind === "ok") {
    const columnNotes = [
      state.addedColumns > 0 &&
        t.importAddedColumns.replace("{n}", formatInt(state.addedColumns, locale)),
      state.droppedColumns > 0 &&
        t.importDroppedColumns.replace("{n}", formatInt(state.droppedColumns, locale)),
      state.removed > 0 &&
        t.importRemoved.replace("{n}", formatInt(state.removed, locale)),
      state.skipped.length > 0 &&
        t.importSkipped.replace(
          "{n}",
          formatInt(new Set(state.skipped.map((e) => e.row)).size, locale),
        ),
    ].filter((s): s is string => Boolean(s));

    return (
      <>
        <p className="mt-1.5 border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[12px]">
          {t.importSummary
            .replace("{inserted}", formatInt(state.inserted, locale))
            .replace("{updated}", formatInt(state.updated, locale))}
          {columnNotes.length > 0 && ` ${columnNotes.join(" · ")}.`}
        </p>
        {state.priceless.length > 0 && (
          <div className="mt-1.5 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-2.5 py-1.5">
            {/* Allowed — pricing happens on the phone — but the other way to
                arrive here is clearing the column by accident in Excel. */}
            <p className="mb-1 text-[12px] font-bold">{t.importPriceless}</p>
            <p className="tech text-[11px]">
              {state.priceless.slice(0, MAX_SHOWN).join(", ")}
              {state.priceless.length > MAX_SHOWN &&
                ` + ${formatInt(state.priceless.length - MAX_SHOWN, locale)}`}
            </p>
          </div>
        )}
        {state.mismatches.length > 0 && (
          <div className="mt-1.5 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-2.5 py-1.5">
            {/* The catalog values were applied, but held/sold are derived from
                orders. Show the adjustment instead of silently absorbing it. */}
            <p className="mb-1 text-[12px] font-bold">{t.importInventoryMismatch}</p>
            <ul className="grid gap-0.5 text-[11px]">
              {state.mismatches.slice(0, MAX_SHOWN).map((m, i) => (
                <li key={i}>
                  <span className="tech font-semibold">{m.partNumber}</span>{" "}
                  <span className="tech">{m.column}</span>:{" "}
                  <span className="tech">{formatInt(m.uploaded, locale)}</span> →{" "}
                  <span className="tech">{formatInt(m.computed, locale)}</span>{" "}
                  <span className="text-[var(--color-ink-muted)]">
                    ({t.importFromOrders})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (state.kind === "message") {
    const text =
      state.message === "no-file"
        ? t.importNoFile
        : state.message === "too-large"
          ? t.importTooLarge
          : state.message === "storage-missing"
            ? t.importStorageMissing
            : state.message === "upload-failed"
              ? t.importUploadFailed
              : state.message === "rate-limit"
                ? t.rateLimited
                : state.message === "bad-plan"
                  ? t.importBadPlan
                  : state.message === "all-rows-skipped"
                    ? t.importAllSkipped
                    : t.importFamilyGone;
    return <Problem>{text}</Problem>;
  }

  if (state.kind === "conflicts" || state.kind === "case-variants") {
    return (
      <Problem>
        {state.kind === "conflicts" ? t.importWrongFamily : t.importCaseVariant}{" "}
        <span className="tech">{state.parts.slice(0, MAX_SHOWN).join(", ")}</span>
      </Problem>
    );
  }

  const shown = state.errors.slice(0, MAX_SHOWN);
  return (
    <div className="mt-1.5 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5">
      <p className="mb-1 text-[12px] font-bold text-[var(--color-danger)]">
        {t.importNothingWritten}
      </p>
      <table className="spec-table">
        <thead>
          <tr>
            <th className="num">{t.importRow}</th>
            <th>{t.importColumn}</th>
            <th>{t.importProblem}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e, i) => (
            <tr key={i}>
              <td className="num tech tech-num">{formatInt(e.row, locale)}</td>
              <td className="tech">{e.column}</td>
              <td className="whitespace-normal">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.errors.length > shown.length && (
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          + {formatInt(state.errors.length - shown.length, locale)}
        </p>
      )}
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}
