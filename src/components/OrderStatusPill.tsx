import { getDict, type Locale } from "@/lib/i18n";
import type { OrderStatus } from "@/lib/orders";

/** Exported so the admin filter links use the same words as the pills. */
export const STATUS_LABEL_KEY = {
  received: "statusReceived",
  invoiced: "statusInvoiced",
  preparing: "statusPreparing",
  shipped: "statusShipped",
  delivered: "statusDelivered",
  cancelled: "statusCancelled",
} as const;

/** Colour carries the same information as the word, for scanning a long queue. */
const TONE: Record<OrderStatus, string> = {
  received: "pill",
  invoiced: "pill pill-warn",
  preparing: "pill pill-warn",
  shipped: "pill",
  delivered: "pill pill-ok",
  cancelled: "pill pill-muted",
};

export function OrderStatusPill({
  locale,
  status,
}: {
  locale: Locale;
  status: OrderStatus;
}) {
  const t = getDict(locale);
  return <span className={TONE[status]}>{t[STATUS_LABEL_KEY[status]]}</span>;
}
