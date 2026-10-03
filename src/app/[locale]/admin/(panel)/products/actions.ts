"use server";

import { revalidatePath } from "next/cache";
import { revalidateCatalogPages } from "@/lib/revalidateCatalog";
import { assertAdminWrite } from "@/lib/admin";
import { catalogImageFileProblem, normalizeCatalogImageUrl } from "@/lib/catalogImages";
import { CatalogStorageError, uploadCatalogImage } from "@/lib/catalogStorage";
import { categoryNodeKey, familyNodeKey, type TaxonomyNodeKey } from "@/lib/adminTaxonomy";
import { isLocale, safeLocale, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString, utf8ByteLength } from "@/lib/requestLimits";
import {
  createCategory,
  createFamily,
  deleteCategory,
  deleteFamily,
  saveAdminTaxonomyChanges,
  type TaxonomyContentChange,
  type TaxonomyOrderChange,
  type TaxonomyVisibilityChange,
} from "@/db/familyQueries";

export type TaxonomyCreateInput = {
  kind: "category" | "family";
  parentId: number | null;
  name: string;
  locale: Locale;
};

export type TaxonomyCreateResult =
  | {
      kind: "created";
      createdKey: TaxonomyNodeKey;
      selectionKey: TaxonomyNodeKey;
    }
  | {
      kind: "error";
      message:
        | "no-name"
        | "no-parent"
        | "has-families"
        | "has-subcategories"
        | "duplicate-name";
    };

/** Create one taxonomy node immediately; the sticky Save never claims to undo it. */
export async function createTaxonomyNodeAction(
  input: TaxonomyCreateInput,
): Promise<TaxonomyCreateResult> {
  await assertAdminWrite();

  if (
    !input ||
    (input.kind !== "category" && input.kind !== "family")
  ) {
    return { kind: "error", message: "no-parent" };
  }
  const locale = isLocale(input.locale) ? input.locale : "en";
  const name = boundedString(input.name, 160);
  if (!name) return { kind: "error", message: "no-name" };
  const parentId = input.parentId;
  if (
    parentId !== null &&
    (!Number.isInteger(parentId) || parentId <= 0)
  ) {
    return { kind: "error", message: "no-parent" };
  }

  // The accepted design has one name field. Until a translator supplies the
  // second locale, a legible duplicate is better than a blank public heading.
  const nameEn = name;
  const nameFa = name;

  if (input.kind === "family") {
    if (parentId === null) return { kind: "error", message: "no-parent" };
    const result = await createFamily(parentId, nameEn, nameFa);
    if (!result.ok) {
      return {
        kind: "error",
        message: result.reason === "no-category" ? "no-parent" : result.reason,
      };
    }
    revalidatePath(`/${locale}/admin/products`);
    revalidatePath("/[locale]/c/[...slug]", "page");
    return {
      kind: "created",
      createdKey: familyNodeKey(result.id),
      // The handoff keeps the owning category in the work pane so the new row
      // and its import affordance are visible in context.
      selectionKey: categoryNodeKey(parentId),
    };
  }

  const result = await createCategory(parentId, nameEn, nameFa);
  if (!result.ok) return { kind: "error", message: result.reason };
  revalidatePath(`/${locale}/admin/products`);
  return {
    kind: "created",
    createdKey: categoryNodeKey(result.id),
    selectionKey: categoryNodeKey(result.id),
  };
}

/**
 * One node's content edit as posted. The description and the image file are
 * what the desktop pane sends; the phone flow edits a node's whole details
 * page under the same Save all, so it may also send both names, an image or
 * diagram address, a diagram file and the two remove flags. Everything past
 * the description is optional, and absent means "leave it as it is".
 */
type SubmittedContent = Omit<TaxonomyContentChange, "imageUrl" | "diagramUrl" | "names"> & {
  imageIndex?: number;
  diagramIndex?: number;
  nameEn?: string;
  nameFa?: string;
  imageUrl?: string;
  diagramUrl?: string;
  removeImage?: boolean;
  removeDiagram?: boolean;
};

type TaxonomySavePayload = {
  orders: TaxonomyOrderChange[];
  content: SubmittedContent[];
  visibility: TaxonomyVisibilityChange[];
};

export type TaxonomySaveResult =
  | "saved"
  | "stale"
  | "bad-data"
  | "bad-file-type"
  | "too-large"
  | "storage-missing"
  | "upload-failed"
  | "no-name"
  | "bad-url";

/**
 * The result, and — when one field of one node is at fault — which. The phone
 * flow puts the message under that field; the desktop pane only reads
 * `result`, which is everything it ever showed.
 */
export type TaxonomySaveResponse = {
  result: TaxonomySaveResult;
  failure?: { kind: "category" | "family"; id: number; field: "name" | "image" | "diagram" };
};

/** Save all reversible workbench changes in one validated database transaction. */
export async function saveTaxonomyWorkbenchAction(
  formData: FormData,
): Promise<TaxonomySaveResponse> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const raw = String(formData.get("payload") ?? "");
  const refuse = (result: TaxonomySaveResult): TaxonomySaveResponse => ({ result });
  if (utf8ByteLength(raw) > REQUEST_LIMITS.importerControlBytes) return refuse("bad-data");

  let payload: TaxonomySavePayload;
  try {
    payload = JSON.parse(raw) as TaxonomySavePayload;
  } catch {
    return refuse("bad-data");
  }
  if (
    !Array.isArray(payload.orders) ||
    !Array.isArray(payload.content) ||
    !Array.isArray(payload.visibility)
  ) return refuse("bad-data");
  if (
    payload.orders.length > 120 ||
    payload.content.length > 220 ||
    payload.visibility.length > 220
  ) return refuse("bad-data");

  const orders: TaxonomyOrderChange[] = [];
  const orderScopes = new Set<string>();
  for (const order of payload.orders) {
    if (order?.kind !== "category" && order?.kind !== "family") return refuse("bad-data");
    if (!Array.isArray(order.orderedIds) || order.orderedIds.length > 240) return refuse("bad-data");
    if (!order.orderedIds.every((id) => Number.isInteger(id) && id > 0)) return refuse("bad-data");
    if (order.kind === "category") {
      if (
        order.parentId !== null &&
        (!Number.isInteger(order.parentId) || order.parentId <= 0)
      ) return refuse("bad-data");
    } else if (!Number.isInteger(order.parentId) || order.parentId <= 0) {
      return refuse("bad-data");
    }
    const scope = `${order.kind}:${order.parentId ?? "root"}`;
    if (orderScopes.has(scope)) return refuse("bad-data");
    orderScopes.add(scope);
    orders.push(order);
  }

  const content: TaxonomyContentChange[] = [];
  const contentKeys = new Set<string>();
  const uploads: Array<{ edit: TaxonomyContentChange; slot: "image" | "diagram"; file: File }> = [];
  for (const submitted of payload.content) {
    if (submitted?.kind !== "category" && submitted?.kind !== "family") return refuse("bad-data");
    if (!Number.isInteger(submitted.id) || submitted.id <= 0) return refuse("bad-data");
    const fail = (result: TaxonomySaveResult, field: "name" | "image" | "diagram") => ({
      result,
      failure: { kind: submitted.kind, id: submitted.id, field },
    });
    const aboutEn = boundedString(
      submitted.aboutEn,
      REQUEST_LIMITS.catalogDescriptionChars,
      { allowEmpty: true, trim: false },
    );
    const aboutFa = boundedString(
      submitted.aboutFa,
      REQUEST_LIMITS.catalogDescriptionChars,
      { allowEmpty: true, trim: false },
    );
    if (aboutEn === null || aboutFa === null) return refuse("bad-data");
    const key = `${submitted.kind}:${submitted.id}`;
    if (contentKeys.has(key)) return refuse("bad-data");
    contentKeys.add(key);

    const edit: TaxonomyContentChange = {
      kind: submitted.kind,
      id: submitted.id,
      aboutEn,
      aboutFa,
    };

    // Both names or neither, and neither blank: the same rule the category
    // editor's `saveCatalogMediaAction` applies to the same two columns.
    if (submitted.nameEn !== undefined || submitted.nameFa !== undefined) {
      const nameEn = boundedString(submitted.nameEn, 160, { allowEmpty: true });
      const nameFa = boundedString(submitted.nameFa, 160, { allowEmpty: true });
      if (nameEn === null || nameFa === null) return refuse("bad-data");
      if (!nameEn || !nameFa) return fail("no-name", "name");
      edit.names = { nameEn, nameFa };
    }

    /*
     * One slot, read the way `saveCatalogMediaAction` reads it: a chosen file
     * wins, then the remove tick, then a typed address. The image file has
     * been part of this payload since the workbench shipped; the rest is the
     * phone's details page.
     */
    const readSlot = (
      slot: "image" | "diagram",
      index: number | undefined,
      url: string | undefined,
      remove: boolean | undefined,
    ): TaxonomySaveResponse | null => {
      if (remove !== undefined && typeof remove !== "boolean") return refuse("bad-data");
      if (url !== undefined && typeof url !== "string") return refuse("bad-data");
      if (index !== undefined) {
        if (!Number.isInteger(index) || index < 0) return refuse("bad-data");
        const candidate = formData.get(`${slot}_${index}`);
        if (!(candidate instanceof File) || candidate.size === 0) return refuse("bad-data");
        const problem = catalogImageFileProblem(candidate);
        if (problem === "file-type") return fail("bad-file-type", slot);
        if (problem === "file-too-large") return fail("too-large", slot);
        uploads.push({ edit, slot, file: candidate });
        return null;
      }
      if (remove) {
        if (slot === "image") edit.imageUrl = "";
        else edit.diagramUrl = "";
        return null;
      }
      if (url !== undefined && url.trim() !== "") {
        const normalized = normalizeCatalogImageUrl(url.trim());
        if (normalized === null) return fail("bad-url", slot);
        if (slot === "image") edit.imageUrl = normalized;
        else edit.diagramUrl = normalized;
      }
      return null;
    };
    const imageProblem = readSlot(
      "image",
      submitted.imageIndex,
      submitted.imageUrl,
      submitted.removeImage,
    );
    if (imageProblem) return imageProblem;
    const diagramProblem = readSlot(
      "diagram",
      submitted.diagramIndex,
      submitted.diagramUrl,
      submitted.removeDiagram,
    );
    if (diagramProblem) return diagramProblem;
    content.push(edit);
  }

  const visibility: TaxonomyVisibilityChange[] = [];
  const visibilityKeys = new Set<string>();
  for (const submitted of payload.visibility) {
    if (submitted?.kind !== "category" && submitted?.kind !== "family") return refuse("bad-data");
    if (!Number.isInteger(submitted.id) || submitted.id <= 0) return refuse("bad-data");
    if (typeof submitted.isVisible !== "boolean") return refuse("bad-data");
    const key = `${submitted.kind}:${submitted.id}`;
    if (visibilityKeys.has(key)) return refuse("bad-data");
    visibilityKeys.add(key);
    visibility.push({
      kind: submitted.kind,
      id: submitted.id,
      isVisible: submitted.isVisible,
    });
  }

  // Upload only after every field and every file is valid. Object storage
  // cannot join a Postgres transaction, so a later DB-staleness refusal can
  // still orphan an immutable object; the existing media editor has the same
  // unavoidable boundary. Sequential, so a failure stops further uploads.
  for (const upload of uploads) {
    try {
      const url = await uploadCatalogImage(upload.edit.kind, upload.edit.id, upload.file);
      if (upload.slot === "image") upload.edit.imageUrl = url;
      else upload.edit.diagramUrl = url;
    } catch (error) {
      const failure = { kind: upload.edit.kind, id: upload.edit.id, field: upload.slot };
      if (error instanceof CatalogStorageError && error.problem === "not-configured") {
        return { result: "storage-missing", failure };
      }
      return { result: "upload-failed", failure };
    }
  }

  if (!(await saveAdminTaxonomyChanges(orders, content, visibility))) return refuse("stale");

  // Order, names, images and visibility all show only on the cached catalog
  // pages; family and list pages render per request.
  revalidateCatalogPages();
  revalidatePath(`/${locale}/admin/products`);
  return { result: "saved" };
}

export type DeleteState =
  | { kind: "deleted"; what: "family" | "category"; name: string; products: number }
  | { kind: "error"; message: "not-found" | "not-confirmed" };

/**
 * Delete a family or a whole category subtree.
 *
 * Guarded by a typed confirmation rather than a dialog: the button sits in a
 * list of a hundred, and this is the one action on the page that cannot be
 * undone. `assertAdminWrite` still refuses under DEMO_MODE, so a hand-made POST
 * gets the same answer as a disabled button.
 */
export async function deleteCatalogAction(
  _prev: DeleteState | null,
  formData: FormData,
): Promise<DeleteState> {
  await assertAdminWrite();

  const id = Number(formData.get("id"));
  const what = formData.get("what") === "category" ? "category" : "family";
  const name = String(formData.get("name") ?? "");
  const products = Number(formData.get("products")) || 0;

  // The word is checked here, not only in the browser.
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    return { kind: "error", message: "not-confirmed" };
  }

  const ok =
    what === "category" ? await deleteCategory(id) : await deleteFamily(id);
  if (!ok) return { kind: "error", message: "not-found" };

  revalidateCatalogPages();
  return { kind: "deleted", what, name, products };
}
