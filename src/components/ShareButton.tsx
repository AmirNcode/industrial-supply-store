"use client";

import { useState } from "react";

/**
 * Share on a phone, copy everywhere else.
 *
 * A rep's customers are reached through messaging apps, and the phone's own
 * share sheet already lists whichever of those they use — no app-specific
 * links to guess at or keep working. Where there is no share sheet (most
 * desktops) the text is copied instead; `copyOnly` skips the sheet for values
 * that are pasted rather than sent, such as a card number.
 */
export function ShareButton({
  text,
  label,
  copiedLabel,
  title,
  copyOnly = false,
  className = "btn-small",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  title?: string;
  copyOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    if (!copyOnly && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure: do nothing.
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(label, text);
    }
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {copied ? copiedLabel : label}
    </button>
  );
}
