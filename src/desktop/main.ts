// Electron entry: runs the production server inside the app and shows it in a window.
// Built to dist/desktop.mjs next to dist/server.mjs and dist/client (`pnpm desktop`).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, globalShortcut, nativeTheme, shell } from "electron";
import type { Tab } from "@/lib/tabs";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { startTray } from "./tray";

/** An app opened from Finder gets launchd's bare PATH; the collectors need docker, lsof, git, tailscale and ssh from the user's shell. */
function shellPath(): string | undefined {
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\\n__PATH__%s__PATH__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      // .zshrc plugins complain without a terminal; only stdout matters.
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /__PATH__(.*)__PATH__/.exec(out)?.[1] || undefined;
  } catch {
    return undefined;
  }
}

let win: BrowserWindow | undefined;
let appUrl = "";
let settings: Settings;
let shortcutRegistered = true;

function openWindow(pathname = "/") {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Triage",
    show: false,
    // No grey title bar: the page header is the title bar (see `desktop:` classes) and the window buttons sit inside it.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    // the page's --background, so resizing never flashes white in dark mode
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
  });
  win.once("ready-to-show", () => win?.show());
  // Keep "Triage" in the Window menu and Mission Control instead of the page's longer <title>.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.on("closed", () => (win = undefined));
  // Links to dev servers, Tailscale URLs etc. open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === appUrl) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  void win.loadURL(`${appUrl}${pathname}`);
}

/** Bring the window up, opening it if it was closed, and switch to `tab` when given. */
function show(tab?: Tab) {
  const pathname = !tab || tab === "overview" ? "/" : `/${tab}`;
  app.focus({ steal: true });
  if (!win) return openWindow(pathname);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // the dashboard follows popstate (dashboard.tsx), so the tab changes without a reload
  if (tab) void win.webContents.executeJavaScript(`history.pushState(null, "", ${JSON.stringify(pathname)}); dispatchEvent(new PopStateEvent("popstate"))`);
}

/** The global shortcut: hide Triage when it is in front, otherwise bring it up. */
function toggle() {
  if (win?.isFocused()) app.hide();
  else show();
}

function applyShortcut() {
  globalShortcut.unregisterAll();
  shortcutRegistered = !settings.shortcut || globalShortcut.register(settings.shortcut, toggle);
}

async function start() {
  // `pnpm desktop` runs the stock Electron binary, whose Dock icon is Electron's; the packaged app has its own.
  if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, "..", "build", "icon.png"));
  process.env.PATH = shellPath() ?? `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
  // The server reads NODE_ENV when it loads, so set it before the import.
  process.env.NODE_ENV = "production";
  try {
    const server = await import(pathToFileURL(path.join(import.meta.dirname, "server.mjs")).href);
    appUrl = await server.listening;
    openWindow();
    settings = loadSettings();
    applyShortcut();
    const tray = startTray({
      appUrl,
      show,
      settings: () => settings,
      setSettings: (next) => {
        settings = next;
        saveSettings(next);
        applyShortcut();
        tray.refreshMenu();
      },
      shortcutRegistered: () => shortcutRegistered,
    });
  } catch (e) {
    const busy = (e as NodeJS.ErrnoException).code === "EADDRINUSE";
    dialog.showErrorBox(
      "Triage could not start",
      busy
        ? `Port ${process.env.PORT ?? 4777} is already in use. If Triage runs as a LaunchAgent or through pnpm dev, stop it first (pnpm service:uninstall).`
        : String(e),
    );
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (appUrl) show();
  });
  // macOS convention: closing the window keeps the app (and server) running; the Dock icon reopens it.
  app.on("window-all-closed", () => {});
  app.on("activate", () => {
    if (!win && appUrl) openWindow();
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());

  // Not top-level await: Electron emits "ready" only after the main module finishes loading.
  void app.whenReady().then(start);
}
