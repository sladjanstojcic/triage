/**
 * Light / dark / system theme. The choice is remembered in this browser only; "system" follows the OS.
 * A tiny store so the menu and the toaster re-render when it changes.
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "triage-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref = read();

/** "system" resolved against the OS setting. */
export function resolvedTheme(): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

function apply() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark");
  listeners.forEach((l) => l());
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // private window or blocked storage: the choice just lasts until reload
  }
  apply();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply the remembered theme now and follow OS changes while on "system". */
export function initTheme() {
  apply();
  media.addEventListener("change", apply);
}
