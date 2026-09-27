import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { SuccessBanner } from "@/components/Banners";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function RepHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok } = await searchParams;
  const rep = await requireRep(l);

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.welcomeRep.replace("{name}", rep.name)}
      </h1>
      {ok === "password" && <SuccessBanner>{t.passwordChanged}</SuccessBanner>}
    </>
  );
}
