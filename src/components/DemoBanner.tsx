import { DEMO_MODE } from "@/lib/demo";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * Site-wide marker that this deployment is a demo on generated data with a
 * public RFQ inbox. Rendered above the masthead so it is seen before anything
 * else, and never on a production build where DEMO_MODE is unset.
 */
export function DemoBanner({ locale }: { locale: Locale }) {
  if (!DEMO_MODE) return null;
  const t = getDict(locale);
  return (
    <div className="bg-[var(--color-warn)] px-4 py-1.5 text-center text-[12px] font-semibold text-white">
      {t.demoBanner}
    </div>
  );
}
