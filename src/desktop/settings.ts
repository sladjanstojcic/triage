// The desktop app's own preferences, in settings.json in the app's data folder.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/** Global shortcuts the menu offers: the Electron accelerator and how macOS writes it. */
export const SHORTCUTS = [
  { accelerator: "Control+Alt+T", label: "⌃⌥T" },
  { accelerator: "Control+Alt+Space", label: "⌃⌥Space" },
  { accelerator: "Control+Alt+Command+T", label: "⌃⌥⌘T" },
];

export type Settings = {
  /** accelerator that shows or hides the window from any app; off by default, so Triage takes no keys until asked */
  shortcut: string | null;
  /** notify when something new needs attention */
  notifications: boolean;
  /** stop dev servers left idle for a day (attention.ts, forgottenItems) without asking; off until chosen */
  stopForgotten: boolean;
};

const DEFAULTS: Settings = { shortcut: null, notifications: true, stopForgotten: false };

const file = () => path.join(app.getPath("userData"), "settings.json");

/** The saved settings; anything missing or unknown falls back to the default. */
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(readFileSync(file(), "utf8")) as Partial<Settings>;
    return {
      shortcut: SHORTCUTS.some((s) => s.accelerator === saved.shortcut) ? saved.shortcut! : DEFAULTS.shortcut,
      notifications: typeof saved.notifications === "boolean" ? saved.notifications : DEFAULTS.notifications,
      stopForgotten: typeof saved.stopForgotten === "boolean" ? saved.stopForgotten : DEFAULTS.stopForgotten,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings) {
  writeFileSync(file(), `${JSON.stringify(settings, null, 2)}\n`);
}
