import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { requireRepSession } from "@/lib/repSession";

/**
 * The gate for the one rep page a temporary password may reach. The portal's
 * own gate sends a rep with `must_change_password` here, so this one must not.
 * A layout is not told the path, which is why the split is two route groups
 * rather than one layout with an exception.
 */
export default async function RepSessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireRepSession(locale as Locale);
  return children;
}
