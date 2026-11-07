/**
 * The Overview's "Needs attention" list: things worth acting on across this Mac and the remote hosts,
 * derived from data the scans already have. Pure, so it is tested without a UI.
 */
import type { MachineInfo, RemoteSnapshot, Snapshot, Usage } from "@/lib/collect/types";
import { formatBytes, isExposed } from "@/lib/format";
import { type Conflicts, isUp } from "@/lib/grouping";
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
};

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

export function attentionItems(snap: Snapshot, remote: RemoteSnapshot[] | undefined, conflicts: Conflicts): AttentionItem[] {
  const mac = snap.machine.hostname;
  const items: AttentionItem[] = [...resourceItems(snap.machine, mac)];

  for (const [port, rows] of conflicts) {
    items.push({
      key: `${mac}:shared:${port}`,
      level: "error",
      machine: mac,
      text: `:${port} is bound by ${rows.length} processes`,
      detail: rows.map((r) => r.project?.subpath ?? r.project?.name ?? r.processName).join(", "),
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
    });
  }
  const missing = new Map<string, string>();
  for (const p of snap.ports) if (p.project?.missing) missing.set(p.project.root, p.project.name);
  for (const c of snap.containers) if (isUp(c) && c.project?.missing) missing.set(c.project.root, c.project.name);
  for (const [root, name] of missing) {
    items.push({ key: `${mac}:missing:${root}`, level: "warn", machine: mac, text: `${name} runs from a deleted folder`, tab: "projects" });
  }
  for (const c of snap.containers) {
    if (c.health && c.health !== "healthy") {
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
  items.push(...reclaimItem(snap.dockerDisk, mac, snap.machine, "docker"));

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
      if (c.health && c.health !== "healthy") {
        items.push({ key: `${h.name}:health:${c.id}`, level: "error", machine: h.name, text: `${c.name} is ${c.health}`, tab: "remote" });
      }
    }
    items.push(...reclaimItem(h.dockerDisk, h.name, h.machine, "remote"));
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Docker space that `docker system prune` could free; a warning when the disk is nearly full too. */
function reclaimItem(rows: Snapshot["dockerDisk"], machine: string, m: MachineInfo | undefined, tab: Tab): AttentionItem[] {
  const reclaim = (rows ?? []).reduce((sum, r) => sum + r.reclaimable, 0);
  if (reclaim < RECLAIM_NOTE) return [];
  const diskTight = !!m?.disk && pct(m.disk) >= 0.8;
  return [
    {
      key: `${machine}:reclaim`,
      level: diskTight ? "warn" : "info",
      machine,
      text: `Docker can free ${formatBytes(reclaim)}`,
      detail: "unused images, volumes and build cache (docker system prune)",
      tab,
    },
  ];
}
