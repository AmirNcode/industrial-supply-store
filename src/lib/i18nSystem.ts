/**
 * Wording for the pages a visitor sees when something is missing or broken:
 * "page not found" and "something went wrong" (review R-9).
 *
 * Its own small file, not part of the main dictionary, because both pages are
 * browser components — Next requires that of an error page, and a not-found
 * page is told nothing about its address except through a browser hook — and
 * importing `i18n.ts` there would ship all 2,000 lines of it. The rule is the
 * same as everywhere: `systemFa` is typed as `typeof systemEn`, so a missing
 * Persian line is a compile error.
 */
const systemEn = {
  notFoundTitle: "Page not found",
  notFoundBody:
    "This page does not exist or has been moved. The product may have been renamed or withdrawn from the catalog.",
  errorTitle: "Something went wrong",
  errorBody: "The page could not be loaded. Please try again in a moment.",
  errorRetry: "Try again",
  toHome: "Back to the home page",
  toSearch: "Search the catalog",
};

const systemFa: typeof systemEn = {
  notFoundTitle: "صفحه پیدا نشد",
  notFoundBody:
    "این صفحه وجود ندارد یا جابه‌جا شده است. ممکن است نام کالا تغییر کرده یا از فهرست کالاها حذف شده باشد.",
  errorTitle: "مشکلی پیش آمد",
  errorBody: "بارگذاری صفحه ممکن نشد. لطفاً چند لحظه دیگر دوباره تلاش کنید.",
  errorRetry: "تلاش دوباره",
  toHome: "بازگشت به صفحه اصلی",
  toSearch: "جستجو در کالاها",
};

/** Anything that is not Persian reads English, as an unknown address does. */
export function systemText(locale: unknown): { locale: "en" | "fa"; t: typeof systemEn } {
  return locale === "fa" ? { locale: "fa", t: systemFa } : { locale: "en", t: systemEn };
}
