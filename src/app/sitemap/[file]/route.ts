import { getSitemapCatalog } from "@/db/queries";
import { isLocale } from "@/lib/locale";
import { sitemapEntries, sitemapXml } from "@/lib/siteDomains";

/**
 * One sitemap per language — /sitemap/fa.xml and /sitemap/en.xml — named in
 * robots.txt. Each language's domain comes from `lib/siteDomains.ts`, so giving
 * a language its own market domain later moves its sitemap with it.
 *
 * A plain route handler rather than Next's `sitemap.ts` convention, because
 * that one is prerendered at build, and the build's database connections are
 * capped: the first deploy of the sitemap (2026-11-25) failed with
 * `EMAXCONNSESSION` on exactly that read. Here the build never touches the
 * database; the first request builds it and Vercel's CDN serves that copy for
 * an hour, so it costs two small reads an hour at most, not one per crawler
 * visit. New families need no edit — they appear on the next refresh.
 */
const CACHE_SECONDS = 3600;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const locale = file.replace(/\.xml$/, "");
  if (!file.endsWith(".xml") || !isLocale(locale)) return new Response("Not found", { status: 404 });

  const xml = sitemapXml(sitemapEntries(locale, await getSitemapCatalog()));
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`,
    },
  });
}
