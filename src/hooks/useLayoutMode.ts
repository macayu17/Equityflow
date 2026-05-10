"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type LayoutMode = "dense" | "classic" | "tabs";

const STORAGE_KEY = "equityflow_layout_mode";
const DEFAULT_MODE: LayoutMode = "dense";

export const LAYOUT_MODES: { value: LayoutMode; label: string; shortLabel: string }[] = [
  { value: "dense", label: "Dense Command Center", shortLabel: "Dense" },
  { value: "classic", label: "Classic Brokerage", shortLabel: "Classic" },
  { value: "tabs", label: "Power-User Tabs", shortLabel: "Tabs" },
];

function readStoredMode(): LayoutMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dense" || stored === "classic" || stored === "tabs") return stored;
  return DEFAULT_MODE;
}

function applyMode(mode: LayoutMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.layoutMode = mode;
}

function subscribeToMode(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener("equityflow-layout-mode-change", listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("equityflow-layout-mode-change", listener);
  };
}

export function useLayoutMode() {
  const mode = useSyncExternalStore(subscribeToMode, readStoredMode, () => DEFAULT_MODE);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  const setMode = useCallback((nextMode: LayoutMode) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, nextMode);
    applyMode(nextMode);
    window.dispatchEvent(new Event("equityflow-layout-mode-change"));
  }, []);

  return { mode, setMode, modes: LAYOUT_MODES };
}
