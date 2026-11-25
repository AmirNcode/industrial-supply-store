import type { MetadataRoute } from "next";
import { getSitemapCatalog } from "@/db/queries";
import { isLocale, locales } from "@/lib/locale";
import { sitemapEntries } from "@/lib/siteDomains";

/**
 * One sitemap per language — /sitemap/fa.xml and /sitemap/en.xml. Each
 * language's domain comes from `lib/siteDomains.ts`; split this way, giving a
 * language its own market domain later moves its sitemap with it, since a
 * sitemap may only list addresses on the domain that vouches for it.
 * robots.txt names both.
 *
 * Built from the live catalog, so new families need no edit here; it refreshes
 * at most once an hour, like the category pages, which is two small reads an
 * hour at worst rather than one per crawler visit.
 */
export const revalidate = 3600;

export async function generateSitemaps() {
  return locales.map((id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = await props.id;
  if (!isLocale(id)) return [];
  return sitemapEntries(id, await getSitemapCatalog());
}
