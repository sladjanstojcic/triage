"use client";

import { useEffect } from "react";

/**
 * Run `fn` now, then every `ms` while the tab is visible. The first run goes through a timer so the
 * effect never sets state synchronously.
 */
export function usePolling(fn: () => unknown, ms: number, paused: boolean) {
  useEffect(() => {
    const first = setTimeout(fn, 0);
    const t = paused ? undefined : setInterval(() => document.visibilityState === "visible" && fn(), ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [fn, ms, paused]);
}
