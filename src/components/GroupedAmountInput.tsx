"use client";

import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { digitsBefore, groupDigits, indexAfterDigits } from "@/lib/digits";

/**
 * A whole-rial amount field that shows its thousands marks as it is typed.
 *
 * Rial targets run to eight digits and more, and "10000000" is one zero away
 * from "100000000" at a glance — the difference between a target and ten
 * times it. The marks go into the posted value too; `parseRialAmount` strips
 * them, so the server needs no change and the form still works if this
 * script never loads (the field is then plain text).
 *
 * Regrouping moves the marks under the caret, so the caret is put back after
 * the same digit it followed. Deleting a mark on its own would be undone by the
 * regrouping, so a Backspace or Delete that removed only a mark removes the
 * digit beside it instead — what someone pressing Backspace there means.
 */
export function GroupedAmountInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange">,
) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (input && caret.current !== null && document.activeElement === input) {
      input.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  }, [value]);

  return (
    <input
      {...props}
      ref={ref}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        const input = event.currentTarget;
        let raw = input.value;
        let at = input.selectionStart ?? raw.length;
        const removedOnlyAMark =
          raw.length < value.length && digitsBefore(raw, raw.length) === digitsBefore(value, value.length);
        if (removedOnlyAMark) {
          const deleteForward = (event.nativeEvent as InputEvent).inputType === "deleteContentForward";
          const digitIndex = deleteForward
            ? indexAfterDigits(raw, digitsBefore(raw, at) + 1) - 1
            : indexAfterDigits(raw, digitsBefore(raw, at)) - 1;
          if (digitIndex >= 0 && digitIndex < raw.length) {
            raw = raw.slice(0, digitIndex) + raw.slice(digitIndex + 1);
            if (!deleteForward) at = digitIndex;
          }
        }
        const next = groupDigits(raw);
        caret.current = indexAfterDigits(next, digitsBefore(raw, at));
        setValue(next);
      }}
    />
  );
}
