/**
 * What the `triage` CLI and its MCP server say about ports: plain data, so the text output, `--json` and
 * the agent tools share one rule, and it is tested without a terminal.
 */
import type { PortRow, Snapshot } from "@/lib/collect/types";
import { isExposed, shortCommand, tildify } from "@/lib/format";
import { displayCommand, isListed, portPref } from "@/lib/grouping";
import { containerImpact, impactLines, processImpact } from "@/lib/impact";

export type PortReport = {
  port: number;
  address: string;
  /** what it speaks (http, https, postgres…); missing until Triage has looked */
  protocol?: PortRow["protocol"];
  /** reachable from the network, not just this Mac */
  exposed: boolean;
  kind: PortRow["ownerKind"];
  pid: number;
  /** what is behind the port as the dashboard names it: the short command, container or ssh forward */
  owner: string;
  /** the full command line of a process or ssh tunnel */
  command?: string;
  project?: string;
  branch?: string;
  folder?: string;
  /** agent, app and terminal it was started from, "Claude Code · Zed" */
  startedBy?: string;
  /** nothing that started it is attached any more */
  detached: boolean;
  system: boolean;
  /** `triage stop <port>` can stop it */
  stoppable: boolean;
  /** your note on this port number */
  note?: string;
};

export function portReport(snap: Snapshot, row: PortRow): PortReport {
  const procs = new Map(snap.processes.map((p) => [p.pid, p]));
  const origin = procs.get(row.pid)?.origin;
  const container = row.containerId ? snap.containers.find((c) => c.id.startsWith(row.containerId!)) : undefined;
  return {
    port: row.port,
    address: row.address,
    protocol: row.protocol,
    exposed: isExposed(row.address),
    kind: row.ownerKind,
    pid: row.pid,
    owner: container ? `${container.name} (${container.image})` : shortCommand(tildify(displayCommand(row, procs))),
    command: container ? undefined : tildify(displayCommand(row, procs)),
    project: row.project ? (row.project.subpath ? `${row.project.name}/${row.project.subpath}` : row.project.name) : undefined,
    branch: row.project?.branch,
    folder: row.folder ? tildify(row.folder) : undefined,
    startedBy: [origin?.agent, origin?.app, origin?.terminal].filter(Boolean).join(" · ") || undefined,
    detached: !!origin?.detached,
    system: row.system,
    stoppable: !!stopPlan(snap, row.port, row).target,
    note: portPref(snap, row.port).note,
  };
}

/** Listening ports by number, system services and ports you hid only with `all`. One entry per port and owner, not per address. */
export function portReports(snap: Snapshot, all = false): PortReport[] {
  const seen = new Set<string>();
  return snap.ports
    .filter((r) => isListed(snap, r, all))
    .sort((a, b) => a.port - b.port || a.pid - b.pid)
    .filter((r) => {
      const key = `${r.port}/${r.pid}`;
      return !seen.has(key) && seen.add(key);
    })
    .map((r) => portReport(snap, r));
}

export type StopPlan = {
  /** what a stop signals: a process (its stop pid) or containers */
  target?: { pid: number } | { containerIds: string[] };
  /** "Kill :3000 (shop)" */
  title?: string;
  /** what the stop does, in a sentence */
  action?: string;
  /** the "Also goes down" lines of the dashboard's confirmation */
  alsoGoesDown: string[];
  /** why it can't be stopped from here */
  error?: string;
};

/**
 * How `triage stop <port>` would stop what is on a port, with what else goes down, or why it won't.
 * The same targets the dashboard offers: a dev server (or the CLI that started it), an ssh tunnel, or the
 * container that publishes the port. The server re-checks them against a fresh scan before acting.
 */
export function stopPlan(snap: Snapshot, port: number, only?: PortRow): StopPlan {
  const rows = only ? [only] : snap.ports.filter((r) => r.port === port);
  if (rows.length === 0) return { alsoGoesDown: [], error: `Nothing is listening on :${port}` };
  const owners = new Set(rows.map((r) => r.containerId ?? r.stopPid ?? `pid ${r.pid}`));
  if (owners.size > 1) {
    return { alsoGoesDown: [], error: `:${port} is bound by ${owners.size} owners (pids ${rows.map((r) => r.pid).join(", ")}); stop one by its pid from the dashboard` };
  }
  const row = rows[0];
  const name = row.project ? ` (${row.project.name})` : "";
  if (row.containerId) {
    const c = snap.containers.find((x) => x.id.startsWith(row.containerId!));
    if (!c) return { alsoGoesDown: [], error: `The container behind :${port} is gone` };
    return {
      target: { containerIds: [c.id] },
      title: `Stop container ${c.name}`,
      action: `Runs docker stop on ${c.name}. Data volumes are kept.`,
      alsoGoesDown: impactLines({ ...containerImpact(snap, [c.id]) }, port),
    };
  }
  if (row.system || !row.stopPid) return { alsoGoesDown: [], error: `:${port} belongs to ${row.processName}, which Triage doesn't stop` };
  if (row.ownerKind === "ssh") {
    return {
      target: { pid: row.stopPid },
      title: `Disconnect ${row.sshTarget ?? row.owner}`,
      action: `Kills ssh pid ${row.stopPid}; every forward on this connection closes, not just :${port}.`,
      alsoGoesDown: [],
    };
  }
  const viaCli = row.stopPid !== row.pid;
  return {
    target: { pid: row.stopPid },
    title: `Kill :${port}${name}`,
    action: `Sends SIGTERM to pid ${row.stopPid}${viaCli ? `, the dev CLI that started the server on :${port}` : ""}.`,
    alsoGoesDown: impactLines(processImpact(snap, row.stopPid), port),
  };
}

/** Everything on one port, from every owner and address, and how a stop would go. */
export function whoIs(snap: Snapshot, port: number) {
  return { port, listeners: portReports(snap, true).filter((p) => p.port === port), stop: stopPlan(snap, port) };
}
