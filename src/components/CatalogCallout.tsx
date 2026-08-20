import { CatalogImage } from "./CatalogImage";
import { calloutArt, paragraphs } from "@/lib/catalogCallout";
import { getDict, pick, type Locale } from "@/lib/i18n";

/**
 * The description block above a listing: a picture, a heading, and prose.
 *
 * One component for two entity types, because a category and a family describe
 * themselves the same way and the family page's version of this markup was
 * already the shape a category needed. Keeping one copy is also what keeps
 * `/c/…` and `/l/…` identical above the fold — they are required to be, and two
 * hand-maintained copies would not stay that way.
 *
 * The picture's *size* carries meaning here. A dimension diagram is the thing
 * worth 240px; the catalog photograph that stands in when no diagram has been
 * uploaded stays a 46px thumbnail, so a reader can tell at a glance whether the
 * image explains the measurements or is merely a placeholder. See
 * `calloutArt`.
 */
export type CalloutEntity = {
  nameEn: string;
  nameFa: string;
  aboutEn: string;
  aboutFa: string;
  icon: string;
  imageUrl: string;
  diagramUrl: string;
};

export function CatalogCallout({
  locale,
  entity,
}: {
  locale: Locale;
  entity: CalloutEntity;
}) {
  const t = getDict(locale);
  // Persian is optional; `pick` falls back to English rather than leaving a
  // Persian reader with an empty box.
  const body = paragraphs(pick(entity, "about", locale));
  // A diagram with no prose does not render on its own: the picture illustrates
  // the description, it does not replace it.
  if (body.length === 0) return null;

  const name = pick(entity, "name", locale);
  const art = calloutArt(entity);

  return (
    <div
      className={`mb-4 flex items-start gap-3 rounded-[4px] border border-[var(--color-rule)] border-s-[3px] border-s-[var(--color-navy)] bg-[var(--color-navy-tint)] p-3.5 ${
        // A 240px diagram beside text leaves nothing for the text at 375px, so
        // the two stack on a phone. A thumbnail never needs to.
        art.isDiagram ? "flex-col sm:flex-row" : ""
      }`}
    >
      {/*
        The diagram's box is fixed, and the picture is contained inside it. The
        wrapper is what reserves the space, so an image of any shape arrives
        without moving the text — the same thing the admin card's 88px tile
        does. `CatalogImage` alone cannot: it declares a square from one `size`,
        and a wide drawing would either distort or reserve height it never uses.
      */}
      <span
        className={
          art.isDiagram
            ? "flex h-[160px] w-[240px] shrink-0 items-center justify-center"
            : "shrink-0"
        }
      >
        <CatalogImage
          imageUrl={art.imageUrl}
          icon={art.icon}
          /*
           * The entity name, not an empty alt. It is lossy — it says which
           * family the picture belongs to, not what `Wd.` measures — so
           * anything a reader must know belongs in the description text, which
           * is read out.
           */
          alt={name}
          size={art.size}
          className={
            art.isDiagram
              ? "max-h-[160px] max-w-[240px] object-contain"
              : "h-[46px] w-[46px] object-contain"
          }
          eager={art.isDiagram}
        />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-[var(--color-navy)]">
          {t.aboutPrefix} {name}
        </h2>
        {body.map((para, index) => (
          <p
            key={index}
            className={`${index === 0 ? "mt-0.5" : "mt-2"} text-[12px] leading-snug text-[var(--color-ink)]`}
          >
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}
