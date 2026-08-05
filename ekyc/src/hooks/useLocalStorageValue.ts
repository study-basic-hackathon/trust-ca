"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "trust-ca:local-storage-change";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/**
 * localStorage-backed state that is SSR-safe (null on the server) and stays
 * in sync across tabs and callers via useSyncExternalStore.
 */
export function useLocalStorageValue(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => null,
  );

  const setValue = useCallback(
    (next: string | null) => {
      if (next === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, next);
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue] as const;
}
