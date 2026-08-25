"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { catalogImageFileProblem } from "@/lib/catalogImages";
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
  saveFamilyOrder,
  type TaxonomyContentChange,
  type TaxonomyOrderChange,
  type TaxonomyVisibilityChange,
} from "@/db/familyQueries";

export type NewFamilyState =
  | { kind: "created"; name: string }
  | {
      kind: "error";
      message: "no-name" | "no-category" | "has-subcategories" | "duplicate-name";
    };

/**
 * Create an empty family for an upload to target.
 *
 * It starts with no columns at all, which is the point: the first CSV uploaded
 * into it defines them.
 */
export async function createFamilyAction(
  _prev: NewFamilyState | null,
  formData: FormData,
): Promise<NewFamilyState> {
  await assertAdminWrite();

  const result = await createFamily(
    Number(formData.get("categoryId")),
    String(formData.get("nameEn") ?? ""),
    String(formData.get("nameFa") ?? ""),
  );
  if (!result.ok) return { kind: "error", message: result.reason };

  revalidatePath("/", "layout");
  return { kind: "created", name: String(formData.get("nameEn") ?? "").trim() };
}

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

type TaxonomySavePayload = {
  orders: TaxonomyOrderChange[];
  content: Array<Omit<TaxonomyContentChange, "imageUrl"> & { imageIndex?: number }>;
  visibility: TaxonomyVisibilityChange[];
};

export type TaxonomySaveResult =
  | "saved"
  | "stale"
  | "bad-data"
  | "bad-file-type"
  | "too-large"
  | "storage-missing"
  | "upload-failed";

/** Save all reversible workbench changes in one validated database transaction. */
export async function saveTaxonomyWorkbenchAction(
  formData: FormData,
): Promise<TaxonomySaveResult> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const raw = String(formData.get("payload") ?? "");
  if (utf8ByteLength(raw) > REQUEST_LIMITS.importerControlBytes) return "bad-data";

  let payload: TaxonomySavePayload;
  try {
    payload = JSON.parse(raw) as TaxonomySavePayload;
  } catch {
    return "bad-data";
  }
  if (
    !Array.isArray(payload.orders) ||
    !Array.isArray(payload.content) ||
    !Array.isArray(payload.visibility)
  ) return "bad-data";
  if (
    payload.orders.length > 120 ||
    payload.content.length > 220 ||
    payload.visibility.length > 220
  ) return "bad-data";

  const orders: TaxonomyOrderChange[] = [];
  const orderScopes = new Set<string>();
  for (const order of payload.orders) {
    if (order?.kind !== "category" && order?.kind !== "family") return "bad-data";
    if (!Array.isArray(order.orderedIds) || order.orderedIds.length > 240) return "bad-data";
    if (!order.orderedIds.every((id) => Number.isInteger(id) && id > 0)) return "bad-data";
    if (order.kind === "category") {
      if (
        order.parentId !== null &&
        (!Number.isInteger(order.parentId) || order.parentId <= 0)
      ) return "bad-data";
    } else if (!Number.isInteger(order.parentId) || order.parentId <= 0) {
      return "bad-data";
    }
    const scope = `${order.kind}:${order.parentId ?? "root"}`;
    if (orderScopes.has(scope)) return "bad-data";
    orderScopes.add(scope);
    orders.push(order);
  }

  const content: TaxonomyContentChange[] = [];
  const contentKeys = new Set<string>();
  const uploads: Array<{ edit: TaxonomyContentChange; file: File }> = [];
  for (const submitted of payload.content) {
    if (submitted?.kind !== "category" && submitted?.kind !== "family") return "bad-data";
    if (!Number.isInteger(submitted.id) || submitted.id <= 0) return "bad-data";
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
    if (aboutEn === null || aboutFa === null) return "bad-data";
    const key = `${submitted.kind}:${submitted.id}`;
    if (contentKeys.has(key)) return "bad-data";
    contentKeys.add(key);

    const edit: TaxonomyContentChange = {
      kind: submitted.kind,
      id: submitted.id,
      aboutEn,
      aboutFa,
    };
    if (submitted.imageIndex !== undefined) {
      if (!Number.isInteger(submitted.imageIndex) || submitted.imageIndex < 0) {
        return "bad-data";
      }
      const candidate = formData.get(`image_${submitted.imageIndex}`);
      if (!(candidate instanceof File) || candidate.size === 0) return "bad-data";
      const problem = catalogImageFileProblem(candidate);
      if (problem === "file-type") return "bad-file-type";
      if (problem === "file-too-large") return "too-large";
      uploads.push({ edit, file: candidate });
    }
    content.push(edit);
  }

  const visibility: TaxonomyVisibilityChange[] = [];
  const visibilityKeys = new Set<string>();
  for (const submitted of payload.visibility) {
    if (submitted?.kind !== "category" && submitted?.kind !== "family") return "bad-data";
    if (!Number.isInteger(submitted.id) || submitted.id <= 0) return "bad-data";
    if (typeof submitted.isVisible !== "boolean") return "bad-data";
    const key = `${submitted.kind}:${submitted.id}`;
    if (visibilityKeys.has(key)) return "bad-data";
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
  // unavoidable boundary.
  for (const upload of uploads) {
    try {
      upload.edit.imageUrl = await uploadCatalogImage(
        upload.edit.kind,
        upload.edit.id,
        upload.file,
      );
    } catch (error) {
      if (error instanceof CatalogStorageError && error.problem === "not-configured") {
        return "storage-missing";
      }
      return "upload-failed";
    }
  }

  if (!(await saveAdminTaxonomyChanges(orders, content, visibility))) return "stale";

  if (content.length > 0 || visibility.length > 0) revalidatePath("/", "layout");
  else {
    revalidatePath("/[locale]", "page");
    revalidatePath("/[locale]/c/[...slug]", "page");
  }
  revalidatePath(`/${locale}/admin/products`);
  return "saved";
}

export type FamilyOrderResult = "saved" | "stale";

/**
 * Commit one category's family order.
 *
 * Typed arguments rather than a `FormData`, because this is called directly
 * from a transition instead of by submitting a form. The buttons live inside
 * the group's `<summary>`, which cancels the click's default action so that
 * pressing one does not also collapse the group it belongs to — and a
 * cancelled click never submits a form.
 *
 * `"stale"` means the arrangement no longer describes the category: a family
 * was added or deleted elsewhere while this page sat open. Nothing is written,
 * and the page says so rather than silently applying a partial order.
 */
export async function saveFamilyOrderAction(
  categoryId: number,
  orderedIds: number[],
): Promise<FamilyOrderResult> {
  await assertAdminWrite();

  if (!Number.isInteger(categoryId) || categoryId <= 0) return "stale";
  if (!Array.isArray(orderedIds)) return "stale";
  if (!orderedIds.every((id) => Number.isInteger(id) && id > 0)) return "stale";

  if (!(await saveFamilyOrder(categoryId, orderedIds))) return "stale";

  /*
   * Only the category pages, not the whole layout.
   *
   * Family order is rendered by exactly two things: this admin page, which is
   * dynamic and uncached, and the ISR category pages. The layout-wide purge
   * the other actions use would also invalidate the home pages, quick order
   * and search — and a whole-site purge per reorder is the regeneration storm
   * behind the 2026-08-15 production incident. Batching a session's moves
   * behind one Save button keeps this to one purge per category, rather than
   * one per arrow press.
   */
  revalidatePath("/[locale]/c/[...slug]", "page");
  return "saved";
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

  revalidatePath("/", "layout");
  return { kind: "deleted", what, name, products };
}
