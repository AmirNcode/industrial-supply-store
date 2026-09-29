"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import { PROOF_IMAGE_MAX_SIDE, PROOF_MAX_BYTES, isProofType } from "@/lib/paymentProof";
import type { ProofUploadProblem, ProofUploadResult } from "@/lib/paymentProofUpload";

/**
 * The receipt upload: one large button, because this is the step customers
 * miss and the order waits on it.
 *
 * A phone photo is often 3–6 MB, over what a Server Action accepts, so photos
 * are redrawn at a legible 1,800 px as JPEG in the browser first — a few
 * hundred KB. That also turns an iPhone's HEIC, which the server refuses, into
 * a JPEG wherever the browser can open it. A PDF is sent as it is.
 */
export function PaymentProofUpload({
  locale,
  upload,
  hasProofs,
  hint,
}: {
  locale: Locale;
  upload: (formData: FormData) => Promise<ProofUploadResult>;
  hasProofs: boolean;
  hint: string;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const problemText: Record<ProofUploadProblem, string> = {
    empty: t.proofEmpty,
    "too-large": t.proofTooLarge,
    "bad-type": t.proofBadType,
    closed: t.proofClosed,
    full: t.proofFull,
    failed: t.proofFailed,
    "rate-limited": t.proofRateLimited,
  };

  function send(file: File) {
    setMessage(null);
    startTransition(async () => {
      const body = await shrink(file);
      if (body.size > PROOF_MAX_BYTES) {
        setMessage({ ok: false, text: t.proofTooLarge });
        return;
      }
      const data = new FormData();
      data.set("locale", locale);
      data.set("file", body, body instanceof File ? body.name : "receipt.jpg");
      try {
        const result = await upload(data);
        if (result.ok) {
          setMessage({ ok: true, text: t.proofUploaded });
          router.refresh();
        } else {
          setMessage({ ok: false, text: problemText[result.problem] });
        }
      } catch {
        setMessage({ ok: false, text: t.proofFailed });
      }
    });
  }

  return (
    <div className="grid gap-2">
      <p className="text-[12px]">{hint}</p>
      <input
        ref={input}
        type="file"
        // image/* so a phone offers its camera and photo library; the server
        // judges the actual bytes whatever this lets through.
        accept="image/*,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) send(file);
        }}
      />
      <button
        type="button"
        className="btn-primary justify-self-start px-5 py-2.5 text-[14px]"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {pending ? t.proofUploading : hasProofs ? t.proofUploadAnother : t.proofUpload}
      </button>
      {message && (
        <p
          role="status"
          className={`text-[12px] ${message.ok ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

/** A photo redrawn small enough to send; anything else, or a failure, as chosen. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PROOF_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!jpeg) return file;
    // A small PNG screenshot can beat its JPEG; keep whichever is smaller,
    // unless the original is a type the server would refuse anyway.
    return !isProofType(file.type) || jpeg.size < file.size ? jpeg : file;
  } catch {
    return file;
  }
}
