"use client";

import { useFormStatus } from "react-dom";

export default function QuoteSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary mt-3 w-full"
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
    >
      {label}
    </button>
  );
}
