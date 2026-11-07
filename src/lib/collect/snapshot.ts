import os from "node:os";
import { containerTech } from "@/lib/grouping";
import { collectContainers } from "./docker";
import { collectListeningProcesses, listProcesses } from "./local";
import { cachedDockerDisk, collectMachine } from "./machine";
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
          });
          continue;
        }
      }

      const conn = ssh.find((s) => s.pid === p.pid);
      if (conn) {
        const fwd = conn.forwards.find((f) => f.localPort === l.port);
        const dest = fwd?.kind === "D" ? "SOCKS proxy" : fwd?.destHost ? `${fwd.destHost}:${fwd.destPort}` : undefined;
        // a forward to the host's own loopback reaches a port we can look up on that host
        const onHost = fwd?.kind === "L" && /^(localhost|127\.0\.0\.1|::1)$/.test(fwd.destHost ?? "");
        rows.push({
          ...base, ownerKind: "ssh", owner: `${conn.target} → ${dest ?? "?"}`, tech: "SSH tunnel", system: false,
          sshHost: conn.hostname ?? conn.target, remotePort: onHost ? fwd.destPort : undefined, stopPid: conn.stopPid,
        });
        continue;
      }

      const system = p.system || DOCKER_BACKEND.test(p.name);
      // never offer to stop this dashboard itself
      const self = p.stopPid === process.pid || p.stopPid === process.ppid;
      rows.push({
        ...base, ownerKind: "process", owner: p.command, folder: p.cwd, project: p.project, tech: p.tech,
        system, stopPid: system || self ? undefined : p.stopPid,
      });
    }
  }
  return rows.sort((a, b) => a.port - b.port);
}

export async function collectSnapshot(): Promise<Snapshot> {
  const errors: string[] = [];
  const ps = await listProcesses();
  const [listening, docker, tailscale, machine] = await Promise.all([
    collectListeningProcesses(ps),
    collectContainers(),
    collectTailscale(),
    collectMachine(),
  ]);
  if (listening.error) errors.push(`lsof: ${listening.error}`);
  if (docker.error) errors.push(docker.error);

  const [ssh, tunnels] = await Promise.all([
    collectSsh(ps, listening.procs),
    collectTunnels(ps, listening.procs),
  ]);

  return {
    at: new Date().toISOString(),
    hostname: os.hostname(),
    ports: buildPorts(listening.procs, docker.containers, ssh),
    processes: listening.procs,
    containers: docker.containers,
    ssh,
    tunnels: [...tunnels, ...tailscale.tunnels],
    tailscale: tailscale.status,
    machine,
    dockerDisk: cachedDockerDisk(),
    errors,
  };
}
