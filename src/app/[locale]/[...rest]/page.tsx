import { notFound } from "next/navigation";

/**
 * Catches every address under a language that no other page claims, so it gets
 * the localized not-found page inside the site's header and footer. Without
 * this an unmatched address never reaches `[locale]/not-found.tsx` — that file
 * only answers `notFound()` calls — and falls through to the framework's page.
 */
export default function UnmatchedPage() {
  notFound();
}
