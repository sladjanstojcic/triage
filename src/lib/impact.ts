/**
 * What else goes down with a stop: the other ports and processes of the same server, and the tunnels and
 * ssh forwards that lead to its ports and would then point at nothing. Pure, so the confirm dialogs
 * and their tests share one rule.
 */
import type { PortRow, RemoteSnapshot, Snapshot, SshConnection, Tunnel } from "@/lib/collect/types";
import { count, isLoopback } from "@/lib/format";
import { localTunnel } from "@/lib/grouping";

export type Impact = {
  /** ports that close with it, the one the button sits on included */
  ports: PortRow[];
  /** processes in the tree that don't listen: the dev CLI, workers, watchers */
  otherProcesses: number;
  /** tunnel clients and Tailscale serve/funnel entries that proxy to one of those ports */
  tunnels: Tunnel[];
  /** ssh -R forwards that publish one of those ports on a remote host */
  reverseForwards: { target: string; spec: string }[];
};

/** The local port a tunnel target names: "http://localhost:3000", "127.0.0.1:5432", "3000". */
export function targetPort(target: string | undefined): number | undefined {
  const rest = (target ?? "").replace(/^[a-z+]+:\/\//i, "").replace(/\/.*$/, "");
  if (/^\d+$/.test(rest)) return Number(rest);
  const m = rest.match(/^(.+):(\d+)$/);
  return m && (isLoopback(m[1].replace(/^\[|\]$/g, "")) || m[1] === "0.0.0.0") ? Number(m[2]) : undefined;
}

/** Tunnels and reverse forwards that lead to `ports`, skipping the ones that are themselves being stopped. */
function leadingTo(ports: Set<number>, tunnels: Tunnel[], ssh: SshConnection[], stopping: Set<number>) {
  return {
    tunnels: tunnels.filter((t) => !(t.pid && stopping.has(t.pid)) && ports.has(targetPort(t.target) ?? -1)),
    reverseForwards: ssh
      .filter((c) => !stopping.has(c.pid))
      .flatMap((c) =>
        c.forwards
          .filter((f) => f.kind === "R" && f.destPort !== undefined && ports.has(f.destPort) && isLoopback(f.destHost ?? "localhost"))
          .map((f) => ({ target: c.target, spec: f.spec })),
      ),
  };
}

/** Stopping a local process (its `stopPid`): everything in its tree, and what points at its ports. */
export function processImpact(snap: Snapshot, stopPid: number): Impact {
  const tree = new Set(snap.processes.find((p) => p.stopPid === stopPid)?.stopTree.pids ?? [stopPid]);
  const ports = snap.ports.filter((r) => r.ownerKind === "process" && tree.has(r.pid));
  const listening = new Set(ports.map((r) => r.pid));
  return {
    ports,
    otherProcesses: [...tree].filter((pid) => !listening.has(pid)).length,
    ...leadingTo(new Set(ports.map((r) => r.port)), snap.tunnels, snap.ssh, tree),
  };
}

/** Stopping local containers: their published ports, and what points at them. */
export function containerImpact(snap: Snapshot, ids: string[]): Impact {
  const ports = snap.ports.filter((r) => r.containerId && ids.includes(r.containerId));
  return { ports, otherProcesses: 0, ...leadingTo(new Set(ports.map((r) => r.port)), snap.tunnels, snap.ssh, new Set()) };
}

/** Stopping something on a remote host: the local ssh -L forwards to its ports stop leading anywhere. */
export function remoteImpact(host: RemoteSnapshot | undefined, remotePorts: number[], localPorts: PortRow[]): PortRow[] {
  if (!host) return [];
  return remotePorts.flatMap((port) => localTunnel(host, port, localPorts) ?? []);
}

/**
 * The "Also goes down" lines of a confirmation: the other ports (`port` itself is the one being stopped),
 * the rest of the server's processes, and the tunnels and forwards left pointing at nothing.
 */
export function impactLines(impact: Impact | undefined, port?: number, localTunnels: PortRow[] = []): string[] {
  const ports = [...new Set((impact?.ports ?? []).map((r) => r.port).filter((p) => p !== port))];
  const others = impact?.otherProcesses ?? 0;
  return [
    ...(ports.length > 0 ? [`${count(ports.length, "more port")}: ${ports.map((p) => `:${p}`).join(" ")}`] : []),
    ...(others > 0 ? [`${others} more ${others === 1 ? "process" : "processes"} of this server (dev CLI, workers, watchers)`] : []),
    ...(impact?.tunnels ?? []).map((t) => `${t.kind}${t.publicUrl ? ` ${t.publicUrl}` : ""} stops working`),
    ...(impact?.reverseForwards ?? []).map((f) => `ssh -R ${f.spec} on ${f.target} stops working`),
    ...localTunnels.map((r) => `local tunnel :${r.port} (ssh ${r.sshTarget}) leads nowhere`),
  ];
}
