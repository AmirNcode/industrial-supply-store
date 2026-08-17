"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";

/**
 * Disclosure state that is automatically closed by a route change.
 *
 * The route key makes "closed after navigation" derived state rather than a
 * synchronous setState inside an effect. A later interaction adopts the new
 * pathname and behaves like an ordinary boolean setter.
 */
export function useRouteDisclosure(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const pathname = usePathname();
  const [state, setState] = useState(() => ({ pathname, open: false }));
  const open = state.pathname === pathname && state.open;

  const setOpen: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      setState((previous) => {
        const current = previous.pathname === pathname ? previous.open : false;
        return {
          pathname,
          open: typeof next === "function" ? next(current) : next,
        };
      });
    },
    [pathname],
  );

  return [open, setOpen];
}
