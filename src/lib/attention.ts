/**
 * The Overview's "Needs attention" list: things worth acting on across this Mac and the remote hosts,
 * derived from data the scans already have. Pure, so it is tested without a UI.
 */
import type { MachineInfo, RemoteSnapshot, Snapshot, Usage } from "@/lib/collect/types";
import { elapsedSeconds, formatBytes, formatMem, humanElapsed, isExposed } from "@/lib/format";
import { type Conflicts, isUnhealthy, isUp, portOwnerName } from "@/lib/grouping";
import type { Tab } from "@/lib/tabs";


export type AttentionItem = {
  key: string;
  level: "error" | "warn" | "info";
  /** which machine it is about */
  machine: string;
  text: string;
  detail?: string;
  /** where the details are */
  tab?: Tab;
  /** a local process the item offers to stop right there */
  stopPid?: number;
  /** offers to delete unused Docker images and build cache: on this Mac, or on the remote host with this id */
  prune?: { hostId?: number };
};

/** A dev server left running and idle (see forgottenItems); the only "info" item worth a notification. */
export const isForgotten = (item: AttentionItem) => item.key.includes(":forgotten:");

/**
 * The items a desktop notification announces: errors and warnings, plus forgotten servers, that weren't
 * in the previous scan and weren't announced in the last `realertMs`, so a flapping item doesn't repeat.
 * Updates `announced` with what it returns.
 */
export function newAlerts(
  items: AttentionItem[],
  previous: Set<string>,
  announced: Map<string, number>,
  now = Date.now(),
  realertMs = 30 * 60_000,
): AttentionItem[] {
  const fresh = items.filter(
    (i) => (i.level !== "info" || isForgotten(i)) && !previous.has(i.key) && now - (announced.get(i.key) ?? -Infinity) >= realertMs,
  );
  for (const i of fresh) announced.set(i.key, now);
  return fresh;
}

/** One watched port that started or stopped listening between two scans. */
export type WatchChange = { port: number; up: boolean; what: string };

/** Each port you watch, with what listens on it now ("" for nothing). */
export function watchedPorts(snap: Snapshot): Map<number, string> {
  const out = new Map<number, string>();
  for (const [port, pref] of Object.entries(snap.portPrefs ?? {})) {
    if (!pref.watched) continue;
    const row = snap.ports.find((r) => r.port === Number(port));
    out.set(Number(port), row ? (row.ownerKind === "process" ? portOwnerName(row) : row.owner) : "");
  }
  return out;
}

/**
 * Watched ports that started or stopped listening since `before`. A port only just watched has no
 * before, so watching a port doesn't announce it; a server restarting between two scans isn't a change.
 */
export function watchChanges(before: Map<number, string>, after: Map<number, string>): WatchChange[] {
  const changes: WatchChange[] = [];
  for (const [port, what] of after) {
    const was = before.get(port);
    if (was === undefined || !was === !what) continue;
    changes.push({ port, up: !!what, what: what || was });
  }
  return changes;
}

/** A dev server running this long that isn't using the CPU was most likely left behind. */
export const FORGOTTEN_AFTER_S = 24 * 3600;
const IDLE_CPU = 1;
// MCP servers (an npm package named *mcp*, or one Triage recognises) are agent tools that stay up on purpose.
const MCP_SERVER = /node_modules\/(?:@[^/\s]+\/)?[^/\s]*mcp/i;

const pct = (u: Usage) => u.used / u.total;
const percent = (u: Usage) => `${Math.round(pct(u) * 100)}%`;

/** How full a disk, memory or swap is worth flagging: from 80%, and an error from 90%. The Overview meters use it too. */
export function usageLevel(ratio: number): "error" | "warn" | undefined {
  return ratio >= 0.9 ? "error" : ratio >= 0.8 ? "warn" : undefined;
}

/** Disk, swap and CPU load against their limits. */
function resourceItems(m: MachineInfo, machine: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const diskLevel = m.disk && usageLevel(pct(m.disk));
  if (m.disk && diskLevel) {
    items.push({
      key: `${machine}:disk`,
      level: diskLevel,
      machine,
      text: `Disk ${percent(m.disk)} full`,
      detail: `${formatBytes(m.disk.total - m.disk.used)} free of ${formatBytes(m.disk.total)}`,
    });
  }
  const swapLevel = m.swap && m.swap.total > 0 && usageLevel(pct(m.swap));
  if (m.swap && swapLevel) {
    items.push({
      key: `${machine}:swap`,
      level: swapLevel,
      machine,
      text: `Swap ${percent(m.swap)} used`,
      detail: `${formatBytes(m.swap.used, true)} of ${formatBytes(m.swap.total, true)}: memory is under pressure`,
    });
  }
  if (m.load && m.cores && m.load[0] >= m.cores) {
    items.push({
      key: `${machine}:load`,
      level: "warn",
      machine,
      text: `CPU load ${m.load[0].toFixed(1)} on ${m.cores} cores`,
      detail: "more work than cores right now",
    });
  }
  return items;
}

const RECLAIM_NOTE = 10e9;
/** `docker system df` rows the prune button frees (see dockerPrune in src/server/actions.ts). */
export const PRUNABLE = /^(images|build cache)$/i;

export function attentionItems(snap: Snapshot, remote: RemoteSnapshot[] | undefined, conflicts: Conflicts): AttentionItem[] {
  const mac = snap.machine.hostname;
  const items: AttentionItem[] = [...resourceItems(snap.machine, mac)];

  for (const [port, rows] of conflicts) {
    items.push({
      key: `${mac}:shared:${port}`,
      level: "error",
      machine: mac,
      text: `:${port} is bound by ${rows.length} processes`,
      detail: rows.map(portOwnerName).join(", "),
      tab: "projects",
    });
  }
  const sshPids = new Set(snap.ssh.map((c) => c.pid));
  for (const p of snap.processes) {
    if (p.system || !p.origin?.detached) continue;
    const ports = p.listens.map((l) => `:${l.port}`).join(" ");
    // an ssh tunnel lives on the SSH tab; its folder is just where ssh was run from
    const ssh = sshPids.has(p.pid);
    items.push({
      key: `${mac}:detached:${p.pid}`,
      level: "warn",
      machine: mac,
      text: `${ports} has no launcher left`,
      detail: ssh
        ? `ssh tunnel to ${snap.ssh.find((c) => c.pid === p.pid)?.target}`
        : [p.project?.name, p.origin.agent && `started by ${p.origin.agent}`].filter(Boolean).join(" · ") || p.name,
      tab: ssh ? "ssh" : "projects",
      // a tunnel is disconnected from the SSH tab, where autossh is stopped too
      stopPid: ssh ? undefined : p.stopPid,
    });
  }
  items.push(...forgottenItems(snap, mac, sshPids));
  const missing = new Map<string, string>();
  for (const p of snap.ports) if (p.project?.missing) missing.set(p.project.root, p.project.name);
  for (const c of snap.containers) if (isUp(c) && c.project?.missing) missing.set(c.project.root, c.project.name);
  for (const [root, name] of missing) {
    items.push({ key: `${mac}:missing:${root}`, level: "warn", machine: mac, text: `${name} runs from a deleted folder`, tab: "projects" });
  }
  for (const c of snap.containers) {
    if (isUnhealthy(c)) {
      items.push({ key: `${mac}:health:${c.id}`, level: "error", machine: mac, text: `${c.name} is ${c.health}`, tab: "docker" });
    }
  }
  const exposed = snap.ports.filter((p) => !p.system && isExposed(p.address));
  if (exposed.length > 0) {
    items.push({
      key: `${mac}:exposed`,
      level: "info",
      machine: mac,
      text: `${exposed.length} ${exposed.length === 1 ? "port is" : "ports are"} open to your network`,
      detail: exposed.map((p) => `:${p.port}`).join(" "),
      tab: "ports",
    });
  }
  items.push(...reclaimItem(snap.dockerDisk, mac, snap.machine, "docker", undefined));

  for (const h of remote ?? []) {
    if (!h.ok) {
      items.push({ key: `${h.name}:down`, level: "error", machine: h.name, text: "Unreachable over ssh", detail: h.error, tab: "remote" });
      continue;
    }
    if (h.machine) items.push(...resourceItems(h.machine, h.name));
    for (const l of h.listeners) {
      if (l.origin?.detached) {
        items.push({
          key: `${h.name}:detached:${l.port}`,
          level: "warn",
          machine: h.name,
          text: `:${l.port} has no launcher left`,
          detail: l.cwd ?? l.process,
          tab: "remote",
        });
      }
    }
    const stacks = new Map<string, string>();
    for (const c of h.containers) if (isUp(c) && c.project?.missing) stacks.set(c.group ?? c.name, c.project.root);
    for (const [stack] of stacks) {
      items.push({ key: `${h.name}:missing:${stack}`, level: "warn", machine: h.name, text: `${stack} runs from a deleted folder`, tab: "remote" });
    }
    for (const c of h.containers) {
      if (isUnhealthy(c)) {
        items.push({ key: `${h.name}:health:${c.id}`, level: "error", machine: h.name, text: `${c.name} is ${c.health}`, tab: "remote" });
      }
    }
    items.push(...reclaimItem(h.dockerDisk, h.name, h.machine, "remote", h.id));
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * Dev servers whose launcher is still open but that have run for a day without using the CPU: a server
 * an agent or a terminal tab started and nobody stopped. One item per server, however many ports it has.
 * Services the OS runs on purpose (launchd, systemd), MCP servers, tunnels and servers without a project are left out.
 */
function forgottenItems(snap: Snapshot, mac: string, sshPids: Set<number>): AttentionItem[] {
  const stoppable = new Set(snap.ports.flatMap((r) => (r.stopPid ? [r.stopPid] : [])));
  const tunnelPids = new Set(snap.tunnels.flatMap((t) => (t.pid ? [t.pid] : [])));
  const byServer = new Map<number, Snapshot["processes"]>();
  for (const p of snap.processes) {
    if (p.system || !p.project || p.project.missing || p.origin?.detached) continue;
    if (sshPids.has(p.pid) || tunnelPids.has(p.pid) || !stoppable.has(p.stopPid)) continue;
    if (p.origin?.app === "launchd" || p.origin?.app === "systemd") continue;
    if (MCP_SERVER.test(p.command) || p.tech?.includes("MCP")) continue;
    if ((elapsedSeconds(p.elapsed) ?? 0) < FORGOTTEN_AFTER_S || p.stopTree.cpu >= IDLE_CPU) continue;
    byServer.set(p.stopPid, [...(byServer.get(p.stopPid) ?? []), p]);
  }
  return [...byServer].map(([stopPid, procs]) => {
    const p = procs[0];
    const by = [p.origin?.agent, p.origin?.app].filter(Boolean).join(" in ");
    return {
      key: `${mac}:forgotten:${stopPid}`,
      level: "info",
      machine: mac,
      text: `${procs.flatMap((x) => x.listens.map((l) => `:${l.port}`)).join(" ")} idle, up ${humanElapsed(p.elapsed)}`,
      detail: [p.project?.subpath ?? p.project?.name, by && `started by ${by}`, `holds ${formatMem(p.stopTree.memMB)}`]
        .filter(Boolean)
        .join(" · "),
      tab: "projects",
      stopPid,
    };
  });
}

/** Docker space that `docker system prune` could free; a warning when the disk is nearly full too. */
function reclaimItem(
  rows: Snapshot["dockerDisk"],
  machine: string,
  m: MachineInfo | undefined,
  tab: Tab,
  hostId: number | undefined,
): AttentionItem[] {
  const reclaim = (rows ?? []).reduce((sum, r) => sum + r.reclaimable, 0);
  if (reclaim < RECLAIM_NOTE) return [];
  const diskTight = !!m?.disk && !!usageLevel(pct(m.disk));
  // the button deletes only images and build cache; say how much of the total that is, and what stays
  const prunable = (rows ?? []).filter((r) => PRUNABLE.test(r.type)).reduce((sum, r) => sum + r.reclaimable, 0);
  const kept = reclaim - prunable;
  const detail =
    prunable === 0 ? "unused volumes and stopped containers (docker system prune --volumes)"
    : kept < RECLAIM_NOTE / 10 ? "unused images and build cache"
    : `${formatBytes(prunable)} in unused images and build cache; ${formatBytes(kept)} in volumes and stopped containers, which cleanup keeps`;
  return [
    {
      key: `${machine}:reclaim`,
      level: diskTight ? "warn" : "info",
      machine,
      text: `Docker can free ${formatBytes(reclaim)}`,
      detail,
      tab,
      // only images and build cache have a button: they come back with a pull or a build, volumes hold data
      prune: rows?.some((r) => PRUNABLE.test(r.type) && r.reclaimable > 0) ? { hostId } : undefined,
    },
  ];
}
