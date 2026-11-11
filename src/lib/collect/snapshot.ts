import os from "node:os";
import { isLoopback } from "@/lib/format";
import { containerTech } from "@/lib/grouping";
import { collectContainers } from "./docker";
import { collectListeningProcesses, listProcesses } from "./local";
import { cachedDockerDisk, collectMachine } from "./machine";
import { readPortPrefs } from "@/lib/port-prefs";
import { dropExpired } from "@/lib/reserve";
import { cachedProtocol, protocolFromPort } from "./protocol";
import { collectSsh } from "./ssh";
import { collectTailscale, collectTunnels } from "./tunnels";
import type { Container, LocalProcess, PortRow, Snapshot, SshConnection } from "./types";

// Processes that publish container ports on the host (Docker Desktop, OrbStack, Colima/Lima, Podman).
const DOCKER_BACKEND = /^(OrbStack|com\.docker|vpnkit|docker-proxy|Docker|limactl|ssh-agent-lima|gvproxy|podman)/i;

function buildPorts(procs: LocalProcess[], containers: Container[], ssh: SshConnection[]): PortRow[] {
  const rows: PortRow[] = [];
  for (const p of procs) {
    for (const l of p.listens) {
      const base = { port: l.port, address: l.address, pid: p.pid, processName: p.name };

      if (DOCKER_BACKEND.test(p.name)) {
        const c = containers.find((c) => c.ports.some((cp) => cp.hostPort === l.port));
        if (c) {
          const cp = c.ports.find((cp) => cp.hostPort === l.port)!;
          rows.push({
            ...base, ownerKind: "docker", owner: `${c.name} (:${cp.containerPort})`, containerId: c.id,
            folder: c.workdir, project: c.project, tech: containerTech(c), system: false,
            protocol: cachedProtocol(c.id, l.port, l.address, `${c.image} ${c.name}`),
          });
          continue;
        }
      }

      const conn = ssh.find((s) => s.pid === p.pid);
      if (conn) {
        const fwd = conn.forwards.find((f) => f.localPort === l.port);
        const dest = fwd?.kind === "D" ? "SOCKS proxy" : fwd?.destHost ? `${fwd.destHost}:${fwd.destPort}` : undefined;
        // a forward to the host's own loopback reaches a port we can look up on that host
        const onHost = fwd?.kind === "L" && isLoopback(fwd.destHost ?? "");
        rows.push({
          ...base, ownerKind: "ssh", owner: `${conn.target} → ${dest ?? "?"}`, sshTarget: conn.target, tech: "SSH tunnel", system: false,
          sshHost: conn.hostname ?? conn.target, remotePort: onHost ? fwd.destPort : undefined, stopPid: conn.stopPid,
          // a -D forward is a SOCKS proxy; a -L forward speaks whatever the service behind it does
          protocol: fwd?.kind === "D" ? "socks" : (protocolFromPort(fwd?.destPort) ?? cachedProtocol(p.pid, l.port, l.address, dest ?? "")),
        });
        continue;
      }

      const system = p.system || DOCKER_BACKEND.test(p.name);
      // never offer to stop this dashboard itself
      const self = p.stopPid === process.pid || p.stopPid === process.ppid;
      rows.push({
        ...base, ownerKind: "process", owner: p.command, folder: p.cwd, project: p.project, tech: p.tech,
        system, stopPid: system || self ? undefined : p.stopPid,
        ...(!system && p.origin?.brewService && { brewService: p.origin.brewService }),
        // macOS services and apps aren't probed: their ports are hidden by default and none is a dev server
        protocol: system ? undefined : cachedProtocol(p.pid, l.port, l.address, `${p.tech ?? ""} ${p.command}`),
      });
    }
  }
  return rows.sort((a, b) => a.port - b.port);
}

export async function collectSnapshot(): Promise<Snapshot> {
  const errors: string[] = [];
  const psRows = listProcesses();
  const listeningRows = collectListeningProcesses(psRows);
  // ssh and tunnel clients need only ps and lsof, so they don't wait for docker, tailscale or the machine
  const connections = Promise.all([psRows, listeningRows]).then(([ps, l]) =>
    Promise.all([collectSsh(ps, l.procs), collectTunnels(ps, l.procs)]),
  );
  const [listening, [ssh, tunnels], docker, tailscale, machine, portPrefs] = await Promise.all([
    listeningRows,
    connections,
    collectContainers(),
    collectTailscale(),
    collectMachine(),
    // a reservation that ran out is gone for every reader; the file drops it on the next reservation
    readPortPrefs().then((prefs) => dropExpired(prefs, new Date().toISOString())).catch(() => ({})),
  ]);
  if (listening.error) errors.push(`lsof: ${listening.error}`);
  if (docker.error) errors.push(docker.error);

  const ports = buildPorts(listening.procs, docker.containers, ssh);
  // with the proxy up but docker unanswered, container ports show as the proxy's own: not a real change
  const partial = !!listening.error || (!!docker.error && listening.procs.some((p) => DOCKER_BACKEND.test(p.name) && p.listens.length > 0));
  for (const c of docker.containers) {
    for (const cp of c.ports) cp.protocol = ports.find((r) => r.containerId === c.id && r.port === cp.hostPort)?.protocol;
  }
  return {
    at: new Date().toISOString(),
    hostname: os.hostname(),
    ports,
    processes: listening.procs,
    containers: docker.containers,
    ssh,
    tunnels: [...tunnels, ...tailscale.tunnels],
    tailscale: tailscale.status,
    machine,
    dockerDisk: cachedDockerDisk(),
    portPrefs,
    errors,
    ...(partial && { partial }),
  };
}
