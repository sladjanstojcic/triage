import { run } from "@/lib/exec";
import { SSH_TARGET_RE } from "@/lib/ssh-target";
import { parseAddr } from "./local";
import { sshConfig } from "./ssh";
import { describeOrigin, ORIGIN_ENV, parseOriginEnv, processChain, type ProcRow, stopPidFor } from "./origin";
import { visibleContainers } from "@/lib/grouping";
import { DOCKER_DF_MS, parseDockerDf } from "./machine";
import type { ContainerPort, ContainerSummary, DockerDiskRow, MachineInfo, ProjectInfo, RemoteListener, RemoteSnapshot } from "./types";


// Read-only probe run on the remote host (POSIX sh, Linux). Each section is optional.
// Passwordless sudo (if configured) lets ss/readlink see root-owned services like nginx or sshd.
// Checked once per host every 10 min: a failed `sudo -n` writes to the remote auth log.
const SUDO_RECHECK_MS = 10 * 60_000;
const sudoCache = new Map<string, { at: number; ok: boolean }>();

function sudoLine(target: string) {
  const c = sudoCache.get(target);
  // a function, not "S cmd": zsh login shells don't word-split unquoted variables
  const yes = 'S() { sudo -n "$@"; }; R=root';
  const no = 'S() { "$@"; }; R=user';
  if (c && Date.now() - c.at < SUDO_RECHECK_MS) return c.ok ? yes : no;
  return `if sudo -n true 2>/dev/null; then ${yes}; else ${no}; fi`;
}

const PROBE_BODY = [
  'echo \'##HOST\'; hostname; uptime; echo $R',
  `echo '##DOCKER'; F='{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Label "com.docker.compose.project"}}\\t{{.Label "com.supabase.cli.project"}}\\t{{.Label "com.supabase.cli.workdir"}}\\t{{.Label "com.docker.compose.project.working_dir"}}\\t{{.ID}}\\t{{.State}}'; docker ps -a --format "$F" 2>/dev/null || S docker ps -a --format "$F" 2>/dev/null`,
  // each stack folder: does it still exist, its repo root, branch and git dir (a linked worktree's git dir
  // is under <main repo>/.git/worktrees/)
  `echo '##GIT'; { docker ps -a --format "$F" 2>/dev/null || S docker ps -a --format "$F" 2>/dev/null; } | awk -F'\\t' '{ d = $7 != "" ? $7 : $8; if (d != "") print d }' | sort -u | while IFS= read -r d; do printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$d" "$([ -d "$d" ] && echo 1)" "$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)" "$(git -C "$d" rev-parse --absolute-git-dir 2>/dev/null)"; done`,
  "echo '##PORTS'; S ss -ltnpH 2>/dev/null",
  // process table for launch chains; launch environment of each listener and its parent (a server that
  // sets its title can blank its own), for who started it
  "echo '##PS'; ps -eww -o pid=,ppid=,tty=,args= 2>/dev/null",
  `echo '##ENV'; for p in $(S ss -ltnpH 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do for q in $p $(ps -o ppid= -p $p 2>/dev/null); do printf '%s\\t%s\\n' "$q" "$(S cat /proc/$q/environ 2>/dev/null | tr '\\0' '\\n' | grep -E '^(${ORIGIN_ENV.join("|")})=' | tr '\\n' ' ')"; done; done`,
  "echo '##PROCS'; for p in $(S ss -ltnpH 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do printf '%s\\t%s\\t%s\\n' \"$p\" \"$(S readlink /proc/$p/cwd 2>/dev/null)\" \"$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null)\"; done",
  // the machine itself; key=value lines so a missing tool can't shift the others
  [
    "echo '##MACHINE'",
    `printf 'os=%s\\n' "$(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '\\"')"`,
    `printf 'cores=%s\\n' "$(nproc 2>/dev/null)"`,
    `printf 'cpu=%s\\n' "$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2-)"`,
    `printf 'load=%s\\n' "$(cat /proc/loadavg 2>/dev/null)"`,
    `printf 'uptime=%s\\n' "$(cat /proc/uptime 2>/dev/null)"`,
    "grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null",
    `printf 'df=%s\\n' "$(df -kP / 2>/dev/null | tail -1)"`,
  ].join("; "),
].join("; ");

// `docker system df` takes over a second, so a host runs it every DOCKER_DF_MS; between runs the last
// result is reused.
const dockerDfCache = new Map<string, { at: number; rows?: DockerDiskRow[] }>();
const DOCKER_DF = `echo '##DOCKERDF'; docker system df --format '{{json .}}' 2>/dev/null || S docker system df --format '{{json .}}' 2>/dev/null`;

/** The ##MACHINE lines of a Linux host → its identity and load. Memory in use is total minus available. */
export function parseLinuxMachine(lines: string[], hostname: string): MachineInfo {
  const kv = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^(\w+)[=:]\s*(.*)$/);
    if (m) kv.set(m[1], m[2].trim());
  }
  const kb = (key: string) => Number(kv.get(key)?.match(/^(\d+)/)?.[1]) * 1024;
  const usage = (total: number, free: number) => (total > 0 && Number.isFinite(free) ? { used: total - free, total } : undefined);
  const load = kv.get("load")?.split(/\s+/).slice(0, 3).map(Number);
  const up = Number(kv.get("uptime")?.split(/\s+/)[0]);
  const df = kv.get("df")?.split(/\s+/);
  const [used, avail] = [Number(df?.[2]), Number(df?.[3])];
  return {
    hostname,
    os: kv.get("os") || undefined,
    cpu: kv.get("cpu") || undefined,
    cores: Number(kv.get("cores")) || undefined,
    bootedAt: up > 0 ? new Date(Date.now() - up * 1000).toISOString() : undefined,
    load: load?.length === 3 && load.every(Number.isFinite) ? (load as [number, number, number]) : undefined,
    memory: usage(kb("MemTotal"), kb("MemAvailable")),
    swap: usage(kb("SwapTotal"), kb("SwapFree")),
    // used / (used + available), like df's Use%: ext4 keeps reserved blocks out of "available"
    disk: Number.isFinite(used) && Number.isFinite(avail) ? { used: used * 1024, total: (used + avail) * 1024, mount: "/" } : undefined,
  };
}

function sections(out: string) {
  const map: Record<string, string[]> = {};
  let cur = "";
  for (const line of out.split("\n")) {
    const m = line.match(/^##(\w+)$/);
    if (m) cur = m[1];
    else if (cur && line.trim()) (map[cur] ??= []).push(line);
  }
  return map;
}

/**
 * Published ports from `docker ps` text: "0.0.0.0:58322->5432/tcp, [::]:58322->5432/tcp, 8080/tcp".
 * Ports without "->" are exposed inside docker only and left out. The IPv6 twin of a binding is dropped.
 */
export function parseDockerPorts(text: string): ContainerPort[] {
  const out: ContainerPort[] = [];
  for (const m of text.matchAll(/(?:(\[[^\]]*\]|[\d.]+):)?(\d+)(?:-(\d+))?->(\d+)(?:-\d+)?\/(\w+)/g)) {
    const [, ip, from, to, containerPort, proto] = m;
    for (let i = 0; i <= Number(to ?? from) - Number(from); i++) {
      const hostPort = Number(from) + i;
      if (out.some((p) => p.hostPort === hostPort && p.proto === proto)) continue;
      out.push({ hostIp: (ip ?? "").replace(/^\[|\]$/g, ""), hostPort, containerPort: Number(containerPort) + i, proto });
    }
  }
  return out.sort((a, b) => a.hostPort - b.hostPort);
}

/**
 * The ##GIT lines (folder, exists, repo root, branch, git dir) → project per stack folder, named like local
 * projects: repo root name, the stack folder as a subpath, "main repo / worktree" for a linked worktree.
 */
export function parseStackFolders(lines: string[]): Map<string, ProjectInfo> {
  const projects = new Map<string, ProjectInfo>();
  const base = (p: string) => p.split("/").pop() || p;
  for (const line of lines) {
    const [dir, exists, top, branch, gitDir] = line.split("\t");
    if (!dir) continue;
    const root = top || dir;
    const mainRepo = gitDir?.match(/^(.*)\/\.git\/worktrees\//)?.[1];
    projects.set(dir, {
      root,
      name: mainRepo ? `${base(mainRepo)} / ${base(root)}` : base(root),
      subpath: dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : undefined,
      branch: branch && branch !== "HEAD" ? branch : undefined,
      isWorktree: !!mainRepo,
      mainRepo,
      missing: exists !== "1" || undefined,
    });
  }
  return projects;
}

const UNIT_MS: Record<string, number> = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

/**
 * When a container stopped, from docker's status text ("Exited (0) 2 hours ago", "Exited (1) About an hour
 * ago"); `docker ps` has no timestamp. Approximate, which is enough for "stopped in the last day".
 */
export function stoppedAt(status: string, now = Date.now()): string | undefined {
  const m = status.match(/(\d+|an?|About an?|Less than an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_MS[m[2].toLowerCase()]).toISOString();
}

// Linux services that listen on every box. Names as `ss` prints them (cut to 15 characters).
const LINUX_SYSTEM = new Set([
  "sshd", "systemd", "systemd-resolve", "systemd-network", "tailscaled", "chronyd", "ntpd", "rpcbind",
  "cupsd", "dnsmasq", "avahi-daemon", "containerd", "dockerd", "exim4", "master", "snapd",
]);

export async function probeRemote(host: { id: number; name: string; sshTarget: string }): Promise<RemoteSnapshot> {
  const base = { id: host.id, name: host.name, sshTarget: host.sshTarget, at: new Date().toISOString(), listeners: [], containers: [] };
  if (!SSH_TARGET_RE.test(host.sshTarget)) return { ...base, ok: false, error: "invalid ssh target" };

  const df = dockerDfCache.get(host.sshTarget);
  const dfDue = !df || Date.now() - df.at >= DOCKER_DF_MS;
  const script = `${sudoLine(host.sshTarget)}; ${PROBE_BODY}${dfDue ? `; ${DOCKER_DF}` : ""}`;
  const [res, cfg] = await Promise.all([
    run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host.sshTarget, script], 15000),
    sshConfig(host.sshTarget),
  ]);
  const resolvedHost = cfg.hostname;
  if (!res.stdout.includes("##HOST")) {
    return { ...base, resolvedHost, ok: false, error: res.stderr.trim().split("\n").pop() || "ssh failed" };
  }
  const s = sections(res.stdout);
  const rootView = s.HOST?.[2] === "root";
  if (!sudoCache.has(host.sshTarget) || Date.now() - sudoCache.get(host.sshTarget)!.at >= SUDO_RECHECK_MS) {
    sudoCache.set(host.sshTarget, { at: Date.now(), ok: rootView });
  }

  const procs = new Map<number, { cwd?: string; command?: string }>();
  for (const line of s.PROCS ?? []) {
    const [pid, cwd, command] = line.split("\t");
    procs.set(Number(pid), { cwd: cwd || undefined, command: command?.trim() || undefined });
  }

  const table = new Map<number, ProcRow>();
  for (const line of s.PS ?? []) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), tty: m[3], command: m[4] });
  }
  const envs = new Map<number, Record<string, string>>();
  for (const line of s.ENV ?? []) {
    const [pid, vars] = line.split("\t");
    const env = parseOriginEnv(vars ?? "");
    if (Object.keys(env).length > 0) envs.set(Number(pid), env);
  }
  const originOf = (pid: number) => {
    const chain = processChain(pid, table);
    return describeOrigin(chain, envs.get(pid) ?? envs.get(chain[1]?.pid ?? 0) ?? {});
  };

  const projects = parseStackFolders(s.GIT ?? []);

  const containers = (s.DOCKER ?? []).map((line): ContainerSummary => {
    const [name, image, status, ports, compose, supabase, supabaseDir, composeDir, id, state] = line.split("\t");
    const workdir = supabaseDir || composeDir || undefined;
    // "Up 2 days (healthy)" → status "Up 2 days", health "healthy", like the local collector
    const health = status.match(/\((healthy|unhealthy|health: starting)\)/)?.[1]?.replace("health: ", "");
    return {
      id,
      name,
      image,
      state: state || "running",
      stoppedAt: state && state !== "running" ? stoppedAt(status) : undefined,
      status: status.replace(/\s*\((?:healthy|unhealthy|health: starting)\)/, ""),
      health,
      ports: parseDockerPorts(ports ?? ""),
      group: supabase || compose || undefined,
      kind: supabase ? "supabase" : compose ? "compose" : "container",
      workdir,
      project: workdir ? projects.get(workdir) : undefined,
    };
  });
  // "127.0.0.1:55123->3000/tcp" → 55123 belongs to that container (docker-proxy runs as root, so ss can't name it)
  const containerByPort = new Map<number, string>();
  for (const c of containers) for (const p of c.ports) containerByPort.set(p.hostPort, `${c.name} (:${p.containerPort})`);

  const seen = new Set<number>();
  const listeners: RemoteListener[] = [];
  for (const line of s.PORTS ?? []) {
    const cols = line.trim().split(/\s+/);
    const addr = parseAddr(cols[3] ?? "");
    if (!addr || seen.has(addr.port)) continue;
    seen.add(addr.port);
    const m = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    const pid = m ? Number(m[2]) : undefined;
    const proc = m?.[1];
    const container = containerByPort.get(addr.port);
    const system = !!proc && LINUX_SYSTEM.has(proc);
    listeners.push({
      ...addr,
      process: proc,
      pid,
      container,
      system,
      ...(pid ? procs.get(pid) : {}),
      origin: pid && !container && !system ? originOf(pid) : undefined,
      stopPid: pid && !container && !system ? stopPidFor(pid, table) : undefined,
    });
  }

  if (dfDue) dockerDfCache.set(host.sshTarget, { at: Date.now(), rows: s.DOCKERDF ? parseDockerDf(s.DOCKERDF.join("\n")) : undefined });

  return {
    ...base,
    resolvedHost,
    ok: true,
    hostname: s.HOST?.[0],
    machine: parseLinuxMachine(s.MACHINE ?? [], s.HOST?.[0] ?? host.name),
    dockerDisk: dockerDfCache.get(host.sshTarget)?.rows,
    uptime: s.HOST?.[1]?.trim(),
    rootView,
    listeners: listeners.sort((a, b) => a.port - b.port),
    containers: visibleContainers(containers),
  };
}
