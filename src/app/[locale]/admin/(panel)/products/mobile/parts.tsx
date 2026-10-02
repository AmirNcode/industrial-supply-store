"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";

/*
 * Small pieces every phone screen of the products page shares. The icons are
 * inline SVG on purpose: four glyphs do not justify an icon library.
 */

export function ChevronBack() {
  return (
    <svg className="mtx-chevron-back" width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden="true">
      <path d="M7.5 1.5 1.5 7.5l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronForward() {
  return (
    <svg className="mtx-chevron-forward" width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true">
      <path d="m2 2 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Magnifier() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.8" cy="6.8" r="5.3" stroke="currentColor" strokeWidth="2" />
      <path d="m10.8 10.8 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EyeSlash({ label }: { label: string }) {
  return (
    <svg
      className="mtx-eye-slash"
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path
        d="M1.7 10S4.7 5 10 5s8.3 5 8.3 5-3 5-8.3 5-8.3-5-8.3-5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="m3 3 14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** CATEGORY / SUBCATEGORY / FAMILY, as the node header and Jump show it. */
export function KindChip({ node, locale }: { node: AdminTaxonomyNode; locale: Locale }) {
  const t = getDict(locale);
  const label =
    node.kind === "family"
      ? t.taxonomyFamilyTag
      : node.depth === 0
        ? t.taxonomyCategory
        : t.taxonomySubcategory;
  return <span className={`mtx-kind-chip ${node.kind === "family" ? "is-family" : ""}`}>{label}</span>;
}

/** The uppercase label that heads a white section, with an optional count. */
export function SectionHeading({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <h2 className="mtx-section-heading">
      <span>{children}</span>
      {count !== undefined && <span className="mtx-section-count">{count}</span>}
    </h2>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: "ok" | "error" | "warn";
  children: ReactNode;
}) {
  return (
    <p className={`mtx-banner is-${tone}`} role={tone === "ok" ? "status" : "alert"}>
      {children}
    </p>
  );
}

/**
 * The top bar of a page that is not a level of the tree: a product, a node's
 * details, the column check. One action at the start, a two-line title in the
 * middle, and an optional action at the end.
 */
export function TopBar({
  start,
  title,
  kind,
  kindTone,
  end,
}: {
  start: ReactNode;
  title: ReactNode;
  kind?: ReactNode;
  kindTone?: "family";
  end?: ReactNode;
}) {
  return (
    <header className="mtx-top-bar">
      <div className="mtx-top-bar-start">{start}</div>
      <div className="mtx-top-bar-title">
        <strong>{title}</strong>
        {kind && <span className={`mtx-top-bar-kind ${kindTone === "family" ? "is-family" : ""}`}>{kind}</span>}
      </div>
      <div className="mtx-top-bar-end">{end}</div>
    </header>
  );
}

/** The ··· button. It holds only Delete, so it opens that sheet directly. */
export function MoreButton({
  label,
  disabled,
  onClick,
  className = "",
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`mtx-more ${className}`}
      aria-label={label}
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">···</span>
    </button>
  );
}

/**
 * A bottom sheet over the current screen.
 *
 * iOS keeps a fixed element where it was when the keyboard opens, so the
 * sheet would sit behind it; `visualViewport` says how much of the window the
 * keyboard has taken, and the sheet rises by that much.
 */
export function Sheet({
  labelledBy,
  onClose,
  full = false,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  /** Covers the screen below a small gap, for the Jump search. */
  full?: boolean;
  children: ReactNode;
}) {
  const keyboard = useKeyboardInset();
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mtx-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`mtx-sheet ${full ? "is-full" : ""}`}
        style={keyboard > 0 ? { bottom: keyboard } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {!full && <span className="mtx-grabber" aria-hidden="true" />}
        {children}
      </div>
    </div>
  );
}

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** The page behind a sheet or a full-screen layer stays where it was. */
export function useBodyScrollLock() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}

/** A labelled on/off row; the whole row is the target. */
export function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mtx-toggle-row">
      <span className="mtx-toggle-text">
        <span className="mtx-toggle-label">{label}</span>
        {hint && <span className="mtx-toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="mtx-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="mtx-switch" aria-hidden="true" />
    </label>
  );
}

/** A labelled checkbox row; the whole row is the target. */
export function CheckRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mtx-check-row">
      <input
        type="checkbox"
        className="mtx-check-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="mtx-check" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/** Two or more mutually exclusive choices, as one segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mtx-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-selected" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
