import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";

/**
 * /admin has no page of its own since the side panel split it into sections.
 *
 * Orders is the landing spot because it is the queue staff actually work from;
 * settings and products are things you go to on purpose. This page reads
 * nothing, so it needs no gate of its own: the orders page checks the session
 * (`requireAdmin`) and sends an unauthenticated visitor on to the login form.
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
