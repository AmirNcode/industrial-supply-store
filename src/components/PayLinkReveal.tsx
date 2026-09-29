"use client";

import { useState, useTransition } from "react";
import { ShareButton } from "./ShareButton";

/**
 * An order's pay link, fetched only when staff press for it.
 *
 * The link is a bearer credential, so the admin queue does not carry it in its
 * page. Two steps rather than one copy: a clipboard write after a network
 * round trip is refused by Safari, which ties it to the click itself.
 */
export function PayLinkReveal({
  load,
  showLabel,
  copyLabel,
  copiedLabel,
  disabled,
}: {
  load: () => Promise<string | null>;
  showLabel: string;
  copyLabel: string;
  copiedLabel: string;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (url) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        <span className="tech break-all" dir="ltr" data-testid="admin-pay-link">
          {url}
        </span>
        <ShareButton text={url} label={copyLabel} copiedLabel={copiedLabel} copyOnly className="underline" />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="underline disabled:no-underline disabled:opacity-50"
      disabled={disabled || pending}
      onClick={() => startTransition(async () => setUrl(await load()))}
    >
      {showLabel}
    </button>
  );
}
