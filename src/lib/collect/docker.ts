import { run } from "@/lib/exec";
import { visibleContainers } from "@/lib/grouping";
import { projectFor } from "./local";
import { parseSize } from "./machine";
import type { Container, ContainerPort } from "./types";

type Inspect = {
  Id: string;
  Name: string;
  Config: { Image: string; Labels: Record<string, string> | null };
  State: { Status: string; StartedAt?: string; FinishedAt?: string; ExitCode?: number; Health?: { Status: string } };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null };
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
};

/** "Up 15h", "Exited (0) 2h ago", or the bare state. */
function humanStatus(s: Inspect["State"]): string {
  if (s.Status === "running" && s.StartedAt && !Number.isNaN(Date.parse(s.StartedAt))) return `Up ${ago(s.StartedAt)}`;
  if (s.Status === "exited" && s.FinishedAt && !s.FinishedAt.startsWith("0001")) return `Exited (${s.ExitCode ?? 0}) ${ago(s.FinishedAt)} ago`;
  return s.Status;
}

/** `docker stats --format "{{json .}}"` lines → CPU percent and memory (MiB) by short container id. */
export function parseDockerStats(out: string): Map<string, { cpu: number; memMB: number }> {
  const stats = new Map<string, { cpu: number; memMB: number }>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as { ID?: string; CPUPerc?: string; MemUsage?: string };
      if (!s.ID) continue;
      stats.set(s.ID.slice(0, 12), {
        cpu: Number.parseFloat(s.CPUPerc ?? "") || 0,
        // "45.41MiB / 2.91GiB": the part before the slash is what the container uses
        memMB: Math.round(parseSize(s.MemUsage?.split("/")[0] ?? "") / 1024 ** 2),
      });
    } catch {
      // a partial line when docker is shutting down
    }
  }
  return stats;
}

// `docker stats --no-stream` samples for about two seconds, so it refreshes in the background and scans
// use the last sample.
export const DOCKER_STATS_MS = 30_000;
let dockerStats: { at: number; byId: Map<string, { cpu: number; memMB: number }>; pending?: Promise<void> } = { at: 0, byId: new Map() };

function cachedDockerStats() {
  if (Date.now() - dockerStats.at > DOCKER_STATS_MS && !dockerStats.pending) {
    dockerStats.pending = run("docker", ["stats", "--no-stream", "--format", "{{json .}}"], 15_000).then((res) => {
      dockerStats = { at: Date.now(), byId: res.ok ? parseDockerStats(res.stdout) : new Map() };
    });
  }
  return dockerStats.byId;
}

export async function collectContainers(): Promise<{ containers: Container[]; error?: string }> {
  // -a: stopped containers too, so a stack you stopped can be started again (visibleContainers decides)
  const ids = await run("docker", ["ps", "-aq"], 5000);
  if (!ids.ok) {
    const msg = ids.stderr.includes("ENOENT") ? "docker CLI not found" : "docker not reachable (daemon stopped?)";
    return { containers: [], error: msg };
  }
  const idList = ids.stdout.split("\n").filter(Boolean);
  if (idList.length === 0) return { containers: [] };

  const res = await run("docker", ["inspect", ...idList], 8000);
  if (!res.ok) return { containers: [], error: `docker inspect failed: ${res.stderr.trim().slice(0, 200)}` };
  const data = JSON.parse(res.stdout) as Inspect[];
  const stats = cachedDockerStats();

  const containers = await Promise.all(
    data.map(async (c): Promise<Container> => {
      const labels = c.Config.Labels ?? {};
      const ports: ContainerPort[] = [];
      for (const [key, binds] of Object.entries(c.NetworkSettings.Ports ?? {})) {
        const [containerPort, proto] = key.split("/");
        for (const b of binds ?? []) {
          // docker lists the same mapping for 0.0.0.0 and ::, keep one
          if (ports.some((p) => p.hostPort === Number(b.HostPort) && p.proto === proto)) continue;
          ports.push({ hostIp: b.HostIp, hostPort: Number(b.HostPort), containerPort: Number(containerPort), proto });
        }
      }
      const supabase = labels["com.supabase.cli.project"];
      const compose = labels["com.docker.compose.project"];
      const workdir = labels["com.supabase.cli.workdir"] ?? labels["com.docker.compose.project.working_dir"];
      return {
        id: c.Id.slice(0, 12),
        name: c.Name.replace(/^\//, ""),
        image: c.Config.Image,
        state: c.State.Status,
        status: humanStatus(c.State),
        health: c.State.Status === "running" ? c.State.Health?.Status : undefined,
        startedAt: c.State.StartedAt,
        stoppedAt: c.State.Status !== "running" && c.State.FinishedAt && !c.State.FinishedAt.startsWith("0001") ? c.State.FinishedAt : undefined,
        ports: ports.sort((a, b) => a.hostPort - b.hostPort),
        group: supabase ?? compose,
        kind: supabase ? "supabase" : compose ? "compose" : "container",
        workdir,
        project: await projectFor(workdir),
        ...(c.State.Status === "running" ? stats.get(c.Id.slice(0, 12)) : undefined),
      };
    }),
  );
  return { containers: visibleContainers(containers) };
}
