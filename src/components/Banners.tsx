import type { ReactNode } from "react";

/** The settings page's two notices, shared by every page added since. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-danger)] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
      {children}
    </p>
  );
}
