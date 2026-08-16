"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import {
  catalogImageFileProblem,
  normalizeCatalogImageUrl,
} from "@/lib/catalogImages";
import { CatalogStorageError, uploadCatalogImage } from "@/lib/catalogStorage";
import {
  updateCatalogCategory,
  updateCatalogFamily,
  type CatalogEntityUpdate,
} from "@/db/familyQueries";

export type CatalogMediaMessage =
  | "no-name"
  | "bad-url"
  | "bad-file-type"
  | "too-large"
  | "storage-missing"
  | "upload-failed"
  | "not-found";

export type CatalogMediaFailure = {
  entity: "category" | "family";
  id: number;
  message: CatalogMediaMessage;
};

export type CatalogMediaState =
  | { kind: "saved"; count: number }
  | { kind: "error"; failures: CatalogMediaFailure[] };

/**
 * Save every card the operator changed, in one press.
 *
 * One action for the whole page rather than one per card, and one
 * revalidation at the end rather than one per entity. A category page carries
 * a category, its subcategories and a dozen families; saving them one at a
 * time meant a dozen whole-site cache purges in a row, which is the
 * regeneration pattern behind the 2026-08-15 incident.
 *
 * Nothing is written unless every changed card is valid — the same rule the
 * CSV import follows. A typo in one image URL should not leave the operator
 * guessing which of eight edits landed. Uploads are the exception they have to
 * be: they are the one step that cannot be rolled back, so they run only after
 * every field has been checked, and a failed upload still writes nothing.
 */
export async function saveCatalogMediaAction(
  _previous: CatalogMediaState | null,
  formData: FormData,
): Promise<CatalogMediaState> {
  await assertAdminWrite();

  const count = Number(formData.get("count"));
  if (!Number.isInteger(count) || count < 0) {
    return { kind: "error", failures: [] };
  }
  if (count === 0) return { kind: "saved", count: 0 };

  type Pending = {
    entity: "category" | "family";
    id: number;
    nameEn: string;
    nameFa: string;
    isVisible: boolean;
    file: File | null;
    removeImage: boolean;
    /** Set when the URL field alone decides the image. */
    url: string | null;
  };

  const pending: Pending[] = [];
  const failures: CatalogMediaFailure[] = [];

  // Pass one: read and check everything. No uploads, no writes.
  for (let i = 0; i < count; i++) {
    const entity = formData.get(`entity_${i}`) === "family" ? "family" : "category";
    const id = Number(formData.get(`id_${i}`));
    const fail = (message: CatalogMediaMessage) => failures.push({ entity, id, message });

    if (!Number.isInteger(id) || id <= 0) {
      fail("not-found");
      continue;
    }

    const nameEn = String(formData.get(`nameEn_${i}`) ?? "").trim();
    const nameFa = String(formData.get(`nameFa_${i}`) ?? "").trim();
    if (!nameEn || !nameFa) {
      fail("no-name");
      continue;
    }

    const selected = formData.get(`imageFile_${i}`);
    const file = selected instanceof File && selected.size > 0 ? selected : null;
    if (file) {
      const problem = catalogImageFileProblem(file);
      if (problem === "file-type") {
        fail("bad-file-type");
        continue;
      }
      if (problem === "file-too-large") {
        fail("too-large");
        continue;
      }
    }

    const removeImage = formData.get(`removeImage_${i}`) === "on";
    const rawUrl = String(formData.get(`imageUrl_${i}`) ?? "").trim();
    let url: string | null = null;
    if (!file && !removeImage && rawUrl) {
      const normalized = normalizeCatalogImageUrl(rawUrl);
      if (normalized === null) {
        fail("bad-url");
        continue;
      }
      url = normalized;
    }

    pending.push({
      entity,
      id,
      nameEn,
      nameFa,
      isVisible: formData.get(`isVisible_${i}`) === "on",
      file,
      removeImage,
      url,
    });
  }

  if (failures.length > 0) return { kind: "error", failures };

  // Pass two: the uploads, now that nothing else can turn out to be wrong.
  const updates: (CatalogEntityUpdate & { entity: "category" | "family" })[] = [];
  for (const p of pending) {
    let imageUrl: string | undefined;
    if (p.file) {
      try {
        imageUrl = await uploadCatalogImage(p.entity, p.id, p.file);
      } catch (uploadError) {
        const problem =
          uploadError instanceof CatalogStorageError &&
          uploadError.problem === "not-configured"
            ? "storage-missing"
            : "upload-failed";
        return { kind: "error", failures: [{ entity: p.entity, id: p.id, message: problem }] };
      }
    } else if (p.removeImage) {
      imageUrl = "";
    } else if (p.url !== null) {
      imageUrl = p.url;
    }

    updates.push({
      entity: p.entity,
      id: p.id,
      nameEn: p.nameEn,
      nameFa: p.nameFa,
      imageUrl,
      isVisible: p.isVisible,
    });
  }

  // Pass three: write.
  for (const u of updates) {
    const saved =
      u.entity === "category" ? await updateCatalogCategory(u) : await updateCatalogFamily(u);
    if (!saved) failures.push({ entity: u.entity, id: u.id, message: "not-found" });
  }

  // Names, images and visibility are baked into every catalog page, so this
  // one is deliberately the coarse purge — but it is paid once per press.
  revalidatePath("/", "layout");

  if (failures.length > 0) return { kind: "error", failures };
  return { kind: "saved", count: updates.length };
}
