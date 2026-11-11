// The menu bar icon: what needs attention and each project's servers, with notifications for new problems.
// It reads the same HTTP API as the window, so every stop goes through the server's fresh-scan check.
import path from "node:path";
import { app, dialog, Menu, type MenuItemConstructorOptions, nativeImage, Notification, shell, Tray } from "electron";
import { type AttentionItem, attentionItems, isForgotten, newAlerts } from "@/lib/attention";
import type { Protocol, RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { isWeb, localUrl, tildify } from "@/lib/format";
import { findConflicts, groupByProject, type ProjectGroup } from "@/lib/grouping";
import { stopPlan } from "@/lib/report";
import { triageClient } from "@/lib/server-client";
import type { Tab } from "@/lib/tabs";
import { SHORTCUTS, type Settings } from "./settings";

// The window polls every 3 s while it is visible; the menu bar only needs to notice changes.
const SNAPSHOT_MS = 10_000;
const REMOTE_MS = 60_000;
const ATTENTION_SHOWN = 8;
const PORTS_IN_LABEL = 4;

export type TrayDeps = {
  appUrl: string;
  /** show the window, on `tab` when given */
  show: (tab?: Tab) => void;
  settings: () => Settings;
  setSettings: (next: Settings) => void;
  /** false when another app already holds the chosen shortcut */
  shortcutRegistered: () => boolean;
};

const short = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function startTray(d: TrayDeps) {
  const tray = new Tray(nativeImage.createFromPath(path.join(import.meta.dirname, "trayTemplate.png")));
  tray.setToolTip("Triage");

  let snap: Snapshot | undefined;
  let remote: RemoteSnapshot[] | undefined;
  let items: AttentionItem[] = [];
  // keys of the last scan's items; undefined until the first scan, which is taken as is, without notifications
  let previous: Set<string> | undefined;
  let remoteSeen = false;
  const announced = new Map<string, number>();
  // servers already stopped for being idle, so a slow exit isn't signalled twice
  const autoStopped = new Set<number>();
  // a notification that is garbage-collected loses its click handler
  const shown = new Set<Notification>();

  const api = triageClient(d.appUrl);

  function notify(item: AttentionItem, title?: string) {
    if (!Notification.isSupported()) return;
    const remoteHost = item.machine !== snap?.machine.hostname;
    const n = new Notification({
      title: title ?? (remoteHost ? `${item.machine}: ${item.text}` : item.text),
      body: item.detail ?? "",
      silent: item.level === "info",
    });
    n.on("click", () => d.show(item.tab));
    n.on("close", () => shown.delete(n));
    shown.add(n);
    n.show();
  }

  function update() {
    if (!snap) return;
    const mac = snap.machine.hostname;
    items = attentionItems(snap, remote, findConflicts(snap.ports));
    const keys = new Set(items.map((i) => i.key));
    if (!previous) {
      previous = keys;
      remoteSeen = !!remote;
    } else {
      // the first remote probe lands after the first local scan: take its items as they are too
      if (remote && !remoteSeen) {
        remoteSeen = true;
        for (const i of items) if (i.machine !== mac) previous.add(i.key);
      }
      const fresh = newAlerts(items, previous, announced);
      const { notifications, stopForgotten } = d.settings();
      // with automatic stops on, a forgotten server is announced when it is stopped, not when it is found
      if (notifications) fresh.filter((i) => !(stopForgotten && isForgotten(i))).forEach((i) => notify(i));
      previous = keys;
      if (stopForgotten) {
        for (const i of items) {
          if (!isForgotten(i) || !i.stopPid || autoStopped.has(i.stopPid)) continue;
          autoStopped.add(i.stopPid);
          // the server re-checks the pid against a fresh scan, as for any stop
          api.stopProcess(i.stopPid).then(
            () => notifications && notify(i, `Stopped ${i.text.replace(/ idle, up /, ", idle for ")}`),
            () => {},
          );
        }
      }
    }
    // just the icon in the menu bar; the count is in the tooltip and the menu
    const urgent = items.filter((i) => i.level !== "info").length;
    tray.setToolTip(urgent ? `Triage: ${urgent} ${urgent === 1 ? "problem needs" : "problems need"} attention` : "Triage");
    tray.setContextMenu(Menu.buildFromTemplate(menu()));
  }

  async function loadSnapshot() {
    try {
      snap = await api.snapshot();
      update();
    } catch {
      // the server is in this process; a failed scan just keeps the last menu
    }
  }

  async function loadRemote() {
    try {
      remote = await api.remote();
      update();
    } catch {
      // same as above
    }
  }

  /** Kill a project's server after the same confirmation the window shows, as a native dialog. */
  async function confirmStop(g: ProjectGroup, stopPid: number) {
    if (!snap) return;
    const row = g.ports.find((p) => p.stopPid === stopPid);
    if (!row) return;
    // the wording and the "also goes down" lines are the CLI's; this row is the one the menu item names
    const plan = stopPlan(snap, row.port, row);
    if (!plan.target) return;
    const command = stopPid !== row.pid ? snap.processes.find((p) => p.pid === row.pid)?.parentCommand : row.owner;
    app.focus({ steal: true });
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: `${plan.title}?`,
      detail: [
        plan.action,
        command && tildify(command),
        row.folder && tildify(row.folder),
        plan.alsoGoesDown.length > 0 && `Also goes down:\n${plan.alsoGoesDown.map((l) => `• ${l}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttons: ["Kill", "Force kill", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return;
    try {
      await api.stopProcess(stopPid, response === 1);
      setTimeout(loadSnapshot, 600);
    } catch (e) {
      dialog.showErrorBox("Triage could not stop it", e instanceof Error ? e.message : String(e));
    }
  }

  function projectItem(g: ProjectGroup): MenuItemConstructorOptions {
    // every port goes in the label; only the ones a browser can open get an "Open" item
    const all = new Set<number>();
    const urls = new Map<number, string>();
    const add = (port: number, address: string, protocol?: Protocol) => {
      all.add(port);
      if (isWeb(protocol)) urls.set(port, localUrl(address, port).replace(/^http:/, protocol === "https" ? "https:" : "http:"));
    };
    for (const p of g.ports) add(p.port, p.address, p.protocol);
    for (const c of g.containers) for (const p of c.ports) add(p.hostPort, p.hostIp || "*", p.protocol);
    const ports = [...all].sort((a, b) => a - b);
    const stops = new Map<number, number[]>();
    for (const p of g.ports) if (p.stopPid) stops.set(p.stopPid, [...(stops.get(p.stopPid) ?? []), p.port]);
    return {
      label: short(
        `${g.title}  ${ports.slice(0, PORTS_IN_LABEL).map((p) => `:${p}`).join(" ")}${ports.length > PORTS_IN_LABEL ? " …" : ""}`,
      ),
      submenu: [
        ...[...urls.keys()].sort((a, b) => a - b).map((p) => ({ label: `Open ${urls.get(p)}`, click: () => void shell.openExternal(urls.get(p)!) })),
        ...(stops.size > 0 ? [{ type: "separator" as const }] : []),
        ...[...stops].map(([pid, ps], _, all) => {
          const ports = (list: number[]) => [...new Set(list)].map((p) => `:${p}`).join(" ");
          // two servers on the same port (a conflict) are told apart by pid
          const twin = all.some(([other, ps2]) => other !== pid && ports(ps2) === ports(ps));
          return { label: `Kill ${ports(ps)}${twin ? ` (pid ${pid})` : ""}…`, click: () => void confirmStop(g, pid) };
        }),
        { type: "separator" },
        { label: "Show in Triage", click: () => d.show("projects") },
      ],
    };
  }

  function menu(): MenuItemConstructorOptions[] {
    const mac = snap?.machine.hostname;
    const groups = snap ? groupByProject(snap, false).filter((g) => !g.key.startsWith("~~")) : [];
    const { shortcut, notifications } = d.settings();
    return [
      { label: items.length ? "Needs attention" : "Nothing needs attention", enabled: false },
      ...items.slice(0, ATTENTION_SHOWN).map((i) => ({
        label: short(`${i.level === "info" ? "" : "⚠︎ "}${i.machine === mac ? "" : `${i.machine}: `}${i.text}`),
        sublabel: i.detail && short(i.detail, 90),
        click: () => d.show(i.tab),
      })),
      ...(items.length > ATTENTION_SHOWN ? [{ label: `${items.length - ATTENTION_SHOWN} more…`, click: () => d.show("overview") }] : []),
      { type: "separator" },
      { label: groups.length ? "Projects" : "No dev servers running", enabled: false },
      ...groups.map(projectItem),
      { type: "separator" },
      {
        label: "Open Triage",
        accelerator: shortcut ?? undefined,
        // shown here for reference; the global shortcut itself is registered in main.ts
        registerAccelerator: false,
        click: () => d.show(),
      },
      {
        label: "Global Shortcut",
        submenu: [
          { label: "Off", type: "radio", checked: !shortcut, click: () => d.setSettings({ ...d.settings(), shortcut: null }) },
          ...SHORTCUTS.map((s) => ({
            label: s.label,
            type: "radio" as const,
            checked: shortcut === s.accelerator,
            click: () => d.setSettings({ ...d.settings(), shortcut: s.accelerator }),
          })),
          ...(shortcut && !d.shortcutRegistered()
            ? [{ type: "separator" as const }, { label: "Another app already uses this shortcut", enabled: false }]
            : []),
        ],
      },
      {
        label: "Stop Servers Left Idle for a Day",
        type: "checkbox",
        checked: d.settings().stopForgotten,
        click: () => d.setSettings({ ...d.settings(), stopForgotten: !d.settings().stopForgotten }),
      },
      {
        label: "Notify About New Problems",
        type: "checkbox",
        checked: notifications,
        click: () => d.setSettings({ ...d.settings(), notifications: !notifications }),
      },
      { type: "separator" },
      { label: "Quit Triage", role: "quit" },
    ];
  }

  tray.setContextMenu(Menu.buildFromTemplate(menu()));
  void loadSnapshot();
  void loadRemote();
  setInterval(loadSnapshot, SNAPSHOT_MS);
  setInterval(loadRemote, REMOTE_MS);
  return { refreshMenu: () => tray.setContextMenu(Menu.buildFromTemplate(menu())) };
}
