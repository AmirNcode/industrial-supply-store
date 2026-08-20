"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import {
  catalogImageFileProblem,
  normalizeCatalogImageUrl,
} from "@/lib/catalogImages";
import { CatalogStorageError, uploadCatalogImage } from "@/lib/catalogStorage";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
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
  | "too-long"
  | "storage-missing"
  | "upload-failed"
  | "not-found";

/**
 * Which of the card's two image slots the message is about.
 *
 * Both slots take the same URL and file checks, so they produce the same
 * messages; without this a card showing "that image is larger than 4 MB" would
 * not say which of the two files to replace.
 */
export type CatalogMediaField = "card" | "diagram";

export type CatalogMediaFailure = {
  entity: "category" | "family";
  id: number;
  field: CatalogMediaField;
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

  /** One image slot's submitted intent, before anything has been uploaded. */
  type PendingImage = {
    file: File | null;
    remove: boolean;
    /** Set when the URL field alone decides the image. */
    url: string | null;
  };

  type Pending = {
    entity: "category" | "family";
    id: number;
    nameEn: string;
    nameFa: string;
    aboutEn: string;
    aboutFa: string;
    isVisible: boolean;
    card: PendingImage;
    diagram: PendingImage;
  };

  const pending: Pending[] = [];
  const failures: CatalogMediaFailure[] = [];

  // Pass one: read and check everything. No uploads, no writes.
  for (let i = 0; i < count; i++) {
    const entity = formData.get(`entity_${i}`) === "family" ? "family" : "category";
    const id = Number(formData.get(`id_${i}`));
    const fail = (message: CatalogMediaMessage, field: CatalogMediaField = "card") =>
      failures.push({ entity, id, field, message });

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

    // Persian is optional: an empty value renders the English text rather than
    // an empty callout, so only the length is checked here.
    const aboutEn = boundedString(
      formData.get(`aboutEn_${i}`) ?? "",
      REQUEST_LIMITS.catalogDescriptionChars,
      { allowEmpty: true },
    );
    const aboutFa = boundedString(
      formData.get(`aboutFa_${i}`) ?? "",
      REQUEST_LIMITS.catalogDescriptionChars,
      { allowEmpty: true },
    );
    if (aboutEn === null || aboutFa === null) {
      fail("too-long");
      continue;
    }

    /**
     * Both slots take the same file, MIME and URL rules, so they are read by
     * one function — a second slot validated by a near-copy is how the two
     * quietly drift apart.
     */
    const readImage = (
      prefix: "image" | "diagram",
      field: CatalogMediaField,
    ): PendingImage | null => {
      const selected = formData.get(`${prefix}File_${i}`);
      const file = selected instanceof File && selected.size > 0 ? selected : null;
      if (file) {
        const problem = catalogImageFileProblem(file);
        if (problem === "file-type") {
          fail("bad-file-type", field);
          return null;
        }
        if (problem === "file-too-large") {
          fail("too-large", field);
          return null;
        }
      }

      const remove = formData.get(`remove${prefix === "image" ? "Image" : "Diagram"}_${i}`) === "on";
      const rawUrl = String(formData.get(`${prefix}Url_${i}`) ?? "").trim();
      let url: string | null = null;
      if (!file && !remove && rawUrl) {
        const normalized = normalizeCatalogImageUrl(rawUrl);
        if (normalized === null) {
          fail("bad-url", field);
          return null;
        }
        url = normalized;
      }
      return { file, remove, url };
    };

    const card = readImage("image", "card");
    const diagram = readImage("diagram", "diagram");
    // Both are read before either is abandoned, so one press reports every
    // problem on the card rather than only the first.
    if (!card || !diagram) continue;

    pending.push({
      entity,
      id,
      nameEn,
      nameFa,
      aboutEn,
      aboutFa,
      isVisible: formData.get(`isVisible_${i}`) === "on",
      card,
      diagram,
    });
  }

  if (failures.length > 0) return { kind: "error", failures };

  // Pass two: the uploads, now that nothing else can turn out to be wrong.
  const updates: (CatalogEntityUpdate & { entity: "category" | "family" })[] = [];
  for (const p of pending) {
    /** Undefined preserves what the row holds; "" clears it. */
    const resolve = async (slot: PendingImage): Promise<string | undefined> => {
      if (slot.file) return uploadCatalogImage(p.entity, p.id, slot.file);
      if (slot.remove) return "";
      return slot.url ?? undefined;
    };

    let imageUrl: string | undefined;
    let diagramUrl: string | undefined;
    try {
      // Sequential, not concurrent: a second upload starting after the first
      // has failed is one more object to orphan for no gain.
      imageUrl = await resolve(p.card);
      diagramUrl = await resolve(p.diagram);
    } catch (uploadError) {
      const problem =
        uploadError instanceof CatalogStorageError &&
        uploadError.problem === "not-configured"
          ? "storage-missing"
          : "upload-failed";
      return {
        kind: "error",
        failures: [
          {
            entity: p.entity,
            id: p.id,
            field: imageUrl === undefined && p.card.file ? "card" : "diagram",
            message: problem,
          },
        ],
      };
    }

    updates.push({
      entity: p.entity,
      id: p.id,
      nameEn: p.nameEn,
      nameFa: p.nameFa,
      aboutEn: p.aboutEn,
      aboutFa: p.aboutFa,
      imageUrl,
      diagramUrl,
      isVisible: p.isVisible,
    });
  }

  // Pass three: write.
  for (const u of updates) {
    const saved =
      u.entity === "category" ? await updateCatalogCategory(u) : await updateCatalogFamily(u);
    if (!saved) failures.push({ entity: u.entity, id: u.id, field: "card", message: "not-found" });
  }

  // Names, images, descriptions and visibility are baked into every catalog
  // page, so this one is deliberately the coarse purge — but it is paid once
  // per press.
  revalidatePath("/", "layout");

  if (failures.length > 0) return { kind: "error", failures };
  return { kind: "saved", count: updates.length };
}
