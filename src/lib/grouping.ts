/**
 * How the snapshot is sliced into tables. Pure functions with no React: the views render these
 * groups, and the dashboard uses the same keys for expand/collapse all.
 */
import type { Container, ContainerSummary, LocalProcess, SshConnection, PortRow, ProjectInfo, RemoteListener, RemoteSnapshot, Snapshot } from "@/lib/collect/types";

/**
 * Ports bound by more than one unrelated process — the classic "why is my app on the wrong server" bug.
 * Maps each shared port to every row bound to it.
 */
export function findConflicts(ports: PortRow[]) {
  const byPort = new Map<number, PortRow[]>();
  for (const p of ports) byPort.set(p.port, [...(byPort.get(p.port) ?? []), p]);
  return new Map([...byPort].filter(([, rows]) => new Set(rows.map((r) => r.pid)).size > 1));
}

export type Conflicts = ReturnType<typeof findConflicts>;

/** `next-server (v16)` says nothing; show the `next dev` command that started it. */
export function displayCommand(row: PortRow, procs: Map<number, LocalProcess>) {
  const proc = procs.get(row.pid);
  return proc?.parentCommand && /^next-server/.test(row.owner) ? proc.parentCommand : row.owner;
}

// ---------------------------------------------------------------------------
// Projects

export type ProjectGroup = {
  key: string;
  title: string;
  icon: "folder" | "docker" | "other";
  project?: ProjectInfo;
  folder?: string;
  ports: PortRow[];
  containers: Container[];
};

/**
 * Local things you're developing, by folder. SSH forwards are left out on purpose: they have no local
 * folder and are listed on the SSH & Tunnels and Ports tabs.
 */
export function groupByProject(snap: Snapshot, showSystem: boolean): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const get = (key: string, init: Omit<ProjectGroup, "key" | "ports" | "containers">) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, ports: [], containers: [], ...init }));
    return g;
  };

  for (const p of snap.ports) {
    if (p.ownerKind !== "process" || (p.system && !showSystem)) continue;
    if (p.project) {
      const key = p.project.root || p.project.name;
      get(key, { title: p.project.name, icon: "folder", project: p.project, folder: p.project.root }).ports.push(p);
    } else {
      get(p.system ? "~~system" : "~other", { title: p.system ? "System & apps" : "Other listeners", icon: "other" }).ports.push(p);
    }
  }
  // what's running by folder: stopped containers live on the Docker tab only
  for (const c of snap.containers) {
    if (!isUp(c)) continue;
    if (c.project) {
      const key = c.project.root || c.project.name;
      get(key, { title: c.project.name, icon: "folder", project: c.project, folder: c.project.root }).containers.push(c);
    } else if (c.workdir) {
      get(c.workdir, { title: c.workdir.split("/").pop() ?? c.workdir, icon: "folder", folder: c.workdir }).containers.push(c);
    } else {
      get(`~docker:${c.group ?? ""}`, { title: c.group ?? "Standalone containers", icon: "docker" }).containers.push(c);
    }
  }
  return [...groups.values()].sort((a, b) => {
    const rank = (g: ProjectGroup) => (g.key.startsWith("~~") ? 3 : g.key.startsWith("~") ? 2 : 1);
    return rank(a) - rank(b) || a.title.localeCompare(b.title);
  });
}

/** Project folders with something listening (ports, including container ports). */
export function projectCount(snap: Snapshot): number {
  return new Set(snap.ports.filter((p) => p.project).map((p) => p.project!.root || p.project!.name)).size;
}

// ---------------------------------------------------------------------------
// Ports

/** Every listening port in one list, by port number: the "what is on :4099?" lookup. */
export function sortedPorts(snap: Snapshot, showSystem: boolean): PortRow[] {
  return snap.ports.filter((p) => showSystem || !p.system).sort((a, b) => a.port - b.port || a.pid - b.pid);
}

// ---------------------------------------------------------------------------
// Containers

const STOPPED_SHOWN_MS = 24 * 60 * 60_000;

/** A container is up (running, or restarting / paused in place). */
export const isUp = (c: Pick<ContainerSummary, "state">) => c.state === "running" || c.state === "restarting" || c.state === "paused";

/**
 * Which containers the Docker tables show: everything up, plus stopped ones worth starting again: members
 * of a stack that still has something running, or anything stopped in the last 24 hours (so a stack you
 * just stopped stays there with its Start buttons). Older leftovers stay out. Sorted by stack, then name.
 */
export function visibleContainers<C extends ContainerSummary>(containers: C[], now = Date.now()): C[] {
  const liveGroups = new Set(containers.filter(isUp).map((c) => c.group).filter(Boolean));
  return containers
    .filter(
      (c) =>
        isUp(c) ||
        (!!c.group && liveGroups.has(c.group)) ||
        (!!c.stoppedAt && now - Date.parse(c.stoppedAt) < STOPPED_SHOWN_MS),
    )
    .sort((a, b) => (a.group ?? "~").localeCompare(b.group ?? "~") || a.name.localeCompare(b.name));
}

/** Containers bucketed by compose / Supabase project (standalone containers stand alone). */
export function containerGroups<C extends ContainerSummary>(containers: C[]): [string, C[]][] {
  const byGroup = new Map<string, C[]>();
  for (const c of containers) byGroup.set(c.group ?? c.name, [...(byGroup.get(c.group ?? c.name) ?? []), c]);
  return [...byGroup];
}

/** "supabase_studio_rematch-t1" → "studio" */
export function shortContainerName(c: ContainerSummary) {
  if (c.kind === "supabase" && c.group) return c.name.replace(/^supabase_/, "").replace(`_${c.group}`, "");
  if (c.group) return c.name.replace(new RegExp(`^${c.group}[-_]`), "").replace(/[-_]\d+$/, "");
  return c.name;
}

/** Badge label for a container or container group. */
export function containerTech(c: ContainerSummary) {
  return c.kind === "supabase" ? "Supabase" : "Docker";
}

// ---------------------------------------------------------------------------
// Remote

/** A local ssh forward goes to this probed host (matched by ssh alias or its resolved HostName). */
function forwardsTo(row: PortRow, h: RemoteSnapshot) {
  return row.ownerKind === "ssh" && !!row.remotePort && (h.resolvedHost === row.sshHost || h.sshTarget === row.sshHost);
}

/** For a local ssh -L port, the service listening behind it on the remote host (if that host is probed). */
export function remoteTarget(row: PortRow, remote?: RemoteSnapshot[]): { host: string; listener: RemoteListener } | undefined {
  const host = remote?.find((h) => h.ok && forwardsTo(row, h));
  const listener = host?.listeners.find((l) => l.port === row.remotePort);
  return host && listener ? { host: host.name, listener } : undefined;
}

/** The other direction: for a port on a remote host, the local ssh -L forward that reaches it, if any. */
export function localTunnel(host: RemoteSnapshot, remotePort: number, ports: PortRow[]): PortRow | undefined {
  return ports.find((row) => row.remotePort === remotePort && forwardsTo(row, host));
}

// ---------------------------------------------------------------------------
// SSH

export type SshMachine = { key: string; name: string; address: string; connections: SshConnection[] };

const ROLE_ORDER: Record<SshConnection["role"], number> = { tunnel: 0, multiplexed: 1, session: 2 };

/**
 * Outgoing ssh connections by the machine they reach (resolved HostName, so aliases of one box group
 * together), named after the probed remote host for that machine, else the HostName's first label.
 */
export function sshMachines(ssh: SshConnection[], remote?: RemoteSnapshot[]): SshMachine[] {
  const machines = new Map<string, SshMachine>();
  for (const c of ssh) {
    const host = c.hostname ?? c.target;
    const key = host.toLowerCase();
    let m = machines.get(key);
    if (!m) {
      const probed = remote?.find((h) => h.resolvedHost === host || h.sshTarget === c.target);
      const short = /^[\d.:]+$/.test(host) ? host : host.split(".")[0];
      const address = `${c.user ? `${c.user}@` : ""}${host}${c.port && c.port !== "22" ? `:${c.port}` : ""}`;
      machines.set(key, (m = { key, name: probed?.name ?? short, address, connections: [] }));
    }
    m.connections.push(c);
  }
  for (const m of machines.values()) m.connections.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.target.localeCompare(b.target));
  return [...machines.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const SSH_USERS: [RegExp, string][] = [
  [/herdr-core/, "herdr"],
  [/\.vscode-server|code-server/, "VS Code"],
  [/\.cursor-server/, "Cursor"],
  [/zed-remote-server|\.zed_server/, "Zed"],
  [/git-(?:upload|receive)-pack/, "git"],
  [/\brsync\b/, "rsync"],
];

/** The tool an ssh connection without forwards serves, when its command says so ("herdr", "VS Code"). */
export function sshUser(command: string): string | undefined {
  return SSH_USERS.find(([re]) => re.test(command))?.[1];
}
