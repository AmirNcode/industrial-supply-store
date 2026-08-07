import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";

/**
 * /admin has no page of its own since the side panel split it into sections.
 *
 * Orders is the landing spot because it is the queue staff actually work from;
 * settings and products are things you go to on purpose. The gate lives in the
 * panel layout, so an unauthenticated visitor lands on the login form one hop
 * later rather than being decided here twice.
 */
export default async function AdminIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}/admin/orders`);
}
