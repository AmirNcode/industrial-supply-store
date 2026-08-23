"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CatalogImage } from "./CatalogImage";

/**
 * A deliberately small client island around otherwise server-rendered catalog
 * artwork. The tile still uses Next's resized image; only an explicit click
 * requests the original asset, so a full-resolution diagram does not become
 * part of every catalog page's initial payload.
 */
export function CatalogImageLightbox({
  imageUrl,
  icon,
  alt,
  size,
  className = "",
  eager = false,
  openLabel,
  closeLabel,
  fillThumbnail = false,
}: {
  imageUrl: string;
  icon: string;
  alt: string;
  size: number;
  className?: string;
  eager?: boolean;
  openLabel: string;
  closeLabel: string;
  fillThumbnail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // An SVG fallback has no larger source to reveal, so it stays ordinary art
  // rather than advertising an interaction that cannot do anything useful.
  if (!imageUrl) {
    return (
      <CatalogImage
        imageUrl=""
        icon={icon}
        alt={alt}
        size={size}
        className={className}
        eager={eager}
        fill={fillThumbnail}
      />
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`catalog-image-zoom ${
          fillThumbnail ? "h-full w-full items-center justify-center" : ""
        }`}
        aria-label={openLabel}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        title={openLabel}
        onClick={() => setOpen(true)}
      >
        <CatalogImage
          imageUrl={imageUrl}
          icon={icon}
          alt={alt}
          size={size}
          className={className}
          eager={eager}
          fill={fillThumbnail}
        />
        <span className="catalog-image-zoom-badge" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="m12.2 12.2 4.1 4.1M8.5 6v5M6 8.5h5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        className="catalog-image-dialog"
        aria-label={openLabel}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        {open ? (
          <figure className="catalog-image-dialog-frame">
            <button
              type="button"
              className="catalog-image-dialog-close"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={() => setOpen(false)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {/* The lightbox intentionally bypasses Next's optimiser. This is
                the one place the reader asked for the original stored pixels. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={alt}
              className="catalog-image-dialog-image"
              decoding="async"
            />
          </figure>
        ) : null}
      </dialog>
    </>
  );
}
