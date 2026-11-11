import { existsSync } from "node:fs";
import net from "node:net";
import { addHost, listHosts, removeHost } from "@/lib/hosts";
import { NOTE_MAX, readPortPrefs, reservePort, setPortPref } from "@/lib/port-prefs";
import { RESERVE_FOR_MAX, RESERVE_MAX_MINUTES, RESERVE_MINUTES } from "@/lib/reserve";
import { run } from "@/lib/exec";
import { SSH_TARGET_RE } from "@/lib/ssh-target";
import { mergeLogs, parseLogs, parseReclaimed } from "@/lib/collect/docker";
import { forgetDockerDisk, probeRemote, sshRun } from "@/lib/collect/remote";
import { refreshDockerDisk } from "@/lib/collect/machine";
import { collectSnapshot } from "@/lib/collect/snapshot";
import type { ContainerAction, ContainerSummary, LogLine } from "@/lib/collect/types";
import { isUp } from "@/lib/grouping";

export async function addRemoteHost(sshTarget: string, name?: string): Promise<{ error?: string }> {
  const target = sshTarget.trim();
  if (!SSH_TARGET_RE.test(target)) return { error: "Use an ssh alias or user@host (letters, digits, . _ - @)" };
  return (await addHost(target, name?.trim() || target)) ? {} : { error: "Already added" };
}

export async function removeRemoteHost(id: number) {
  await removeHost(id);
}

export async function probeRemoteHosts() {
  return Promise.all((await listHosts()).map(probeRemote));
}

/**
 * Stop a dev server, ssh tunnel or tunnel client. Only pids the dashboard currently offers
 * (non-system listeners, ssh connections, tunnel clients) are accepted, re-checked against a fresh scan.
 */
export async function stopProcess(pid: number, force = false): Promise<{ error?: string }> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || pid === process.ppid) {
    return { error: "Refusing to stop that process" };
  }
  const snap = await collectSnapshot();
  const allowed = new Set<number>([
    ...snap.ports.flatMap((p) => (p.stopPid ? [p.stopPid] : [])),
    ...snap.ssh.map((s) => s.stopPid),
    ...snap.tunnels.flatMap((t) => (t.pid ? [t.pid] : [])),
  ]);
  if (!allowed.has(pid)) return { error: `pid ${pid} is no longer running or isn't stoppable from here` };
  // launchd restarts a killed Homebrew service at once; brew stops it and keeps it from starting at login
  const brew = snap.ports.find((p) => p.stopPid === pid && p.brewService)?.brewService;
  if (brew) return stopBrewService(brew);
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return {};
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { error: code === "EPERM" ? `No permission to stop pid ${pid} (owned by another user)` : String(e) };
  }
}

const BREW = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const FORMULA_RE = /^[\w@.+-]+$/;

/** `brew services stop <formula>`; the formula comes from a fresh scan and is checked again here. */
async function stopBrewService(formula: string): Promise<{ error?: string }> {
  const brew = BREW.find((p) => existsSync(p));
  if (!brew || !FORMULA_RE.test(formula)) return { error: `Can't run brew services stop ${formula}` };
  const res = await run(brew, ["services", "stop", formula], 60_000);
  return res.ok ? {} : { error: res.stderr.trim().slice(0, 300) || `brew services stop ${formula} failed` };
}

const CONTAINER_ID_RE = /^[0-9a-f]{12,64}$/;

// the state each action needs: start a stopped one, pause a running one, unpause a paused one
const NEEDS: Record<ContainerAction, (c: ContainerSummary) => boolean> = {
  start: (c) => !isUp(c),
  stop: isUp,
  restart: (c) => c.state === "running" || c.state === "restarting",
  pause: (c) => c.state === "running",
  unpause: (c) => c.state === "paused",
};

/** Which containers an action applies to, by the state a fresh scan shows. */
function actionable(action: ContainerAction, containers: ContainerSummary[], ids: string[]) {
  const ok = new Set(containers.filter(NEEDS[action]).map((c) => c.id));
  return ids.filter((id) => CONTAINER_ID_RE.test(id) && ok.has(id));
}

const NOT_ACTIONABLE: Record<ContainerAction, string> = {
  start: "Those containers are already running or gone",
  stop: "Those containers are no longer running",
  restart: "Those containers aren't running (a paused one is resumed, not restarted)",
  pause: "Those containers aren't running",
  unpause: "Those containers aren't paused",
};

/** docker start / stop / restart / pause / unpause on this Mac, for containers a fresh scan shows in the right state. */
export async function containerAction(action: ContainerAction, ids: string[]): Promise<{ error?: string }> {
  const valid = actionable(action, (await collectSnapshot()).containers, ids);
  if (valid.length === 0) return { error: NOT_ACTIONABLE[action] };
  const res = await run("docker", [action, ...valid], 90_000);
  return res.ok ? {} : { error: res.stderr.trim().slice(0, 300) || `docker ${action} failed` };
}

/** Run a fixed command on a remote host over ssh; callers only interpolate validated ids and numbers. */
const onHost = (sshTarget: string, command: string) => sshRun(sshTarget, command, 90_000);

async function freshProbe(hostId: number) {
  const host = (await listHosts()).find((h) => h.id === hostId);
  if (!host) return { error: "That host is no longer in the list" } as const;
  const snap = await probeRemote(host);
  if (!snap.ok) return { error: `${host.name} is unreachable: ${snap.error ?? "ssh failed"}` } as const;
  return { host, snap } as const;
}

/**
 * docker start / stop / restart on a remote host, re-checked against a fresh probe. Only container ids
 * reach the remote shell; passwordless sudo is the fallback when the ssh user can't use docker.
 */
export async function remoteContainerAction(hostId: number, action: ContainerAction, ids: string[]): Promise<{ error?: string }> {
  const probe = await freshProbe(hostId);
  if ("error" in probe) return { error: probe.error };
  const valid = actionable(action, probe.snap.containers, ids);
  if (valid.length === 0) return { error: `${NOT_ACTIONABLE[action]} on ${probe.host.name}` };
  const list = valid.join(" ");
  const res = await onHost(probe.host.sshTarget, `docker ${action} ${list} 2>/dev/null || sudo -n docker ${action} ${list}`);
  return res.ok ? {} : { error: res.stderr.trim().slice(0, 300) || `docker ${action} failed on ${probe.host.name}` };
}

/**
 * SIGTERM (or SIGKILL) a dev server on a remote host. Only a pid the fresh probe offers is accepted: a
 * listener's stop pid that isn't a system service or a container port. Only that number reaches the shell.
 */
export async function stopRemoteProcess(hostId: number, pid: number, force = false): Promise<{ error?: string }> {
  if (!Number.isInteger(pid) || pid <= 1) return { error: "Refusing to stop that process" };
  const probe = await freshProbe(hostId);
  if ("error" in probe) return { error: probe.error };
  const allowed = new Set(probe.snap.listeners.flatMap((l) => (l.stopPid ? [l.stopPid] : [])));
  if (!allowed.has(pid)) return { error: `pid ${pid} is no longer running on ${probe.host.name} or isn't stoppable from here` };
  const signal = force ? "KILL" : "TERM";
  const res = await onHost(probe.host.sshTarget, `kill -${signal} ${pid} 2>/dev/null || sudo -n kill -${signal} ${pid}`);
  return res.ok ? {} : { error: res.stderr.trim().slice(0, 300) || `No permission to stop pid ${pid} on ${probe.host.name}` };
}

/** How much of a container's log the logs drawer shows. */
const LOG_LINES = 300;

/**
 * The last lines of a container's log, on this Mac or on a remote host over ssh. Read-only, so there is
 * no fresh scan; only a hex container id reaches docker or the remote shell.
 */
export async function containerLogs(id: string, hostId?: number): Promise<{ lines?: LogLine[]; error?: string }> {
  if (!CONTAINER_ID_RE.test(id)) return { error: "Not a container id" };
  const args = `logs --tail ${LOG_LINES} --timestamps ${id}`;
  if (hostId === undefined) {
    const res = await run("docker", args.split(" "), 15_000);
    return res.ok ? { lines: mergeLogs(res.stdout, res.stderr) } : { error: res.stderr.trim().slice(0, 300) || "docker logs failed" };
  }
  const host = (await listHosts()).find((h) => h.id === hostId);
  if (!host) return { error: "That host is no longer in the list" };
  // 2>&1 keeps the container's stdout and stderr in the order they were written
  const res = await onHost(host.sshTarget, `if docker ps -q >/dev/null 2>&1; then docker ${args} 2>&1; else sudo -n docker ${args} 2>&1; fi`);
  if (!res.ok) return { error: (res.stdout || res.stderr).trim().split("\n").slice(-3).join("\n").slice(0, 300) || `docker logs failed on ${host.name}` };
  return { lines: parseLogs(res.stdout) };
}

// Images no container uses (running or stopped) and the build cache: both come back with a pull or a
// build. Containers, networks and volumes are left alone, so no stack or data disappears.
const PRUNE = ["image prune --all --force", "builder prune --all --force"];

/** Delete unused Docker images and build cache, on this Mac or a remote host (sudo -n as the fallback). */
export async function dockerPrune(hostId?: number): Promise<{ reclaimed?: string; error?: string }> {
  if (hostId === undefined) {
    let out = "";
    for (const cmd of PRUNE) {
      const res = await run("docker", cmd.split(" "), 10 * 60_000);
      if (!res.ok) return { error: res.stderr.trim().slice(0, 300) || `docker ${cmd} failed` };
      out += res.stdout;
    }
    await refreshDockerDisk();
    return { reclaimed: parseReclaimed(out) };
  }
  const host = (await listHosts()).find((h) => h.id === hostId);
  if (!host) return { error: "That host is no longer in the list" };
  const script = PRUNE.map((cmd) => `docker ${cmd}`).join(" && ");
  const res = await sshRun(host.sshTarget, `if docker ps -q >/dev/null 2>&1; then ${script}; else ${script.replaceAll("docker ", "sudo -n docker ")}; fi`, 10 * 60_000);
  forgetDockerDisk(host.sshTarget);
  return res.ok ? { reclaimed: parseReclaimed(res.stdout) } : { error: res.stderr.trim().slice(0, 300) || `docker prune failed on ${host.name}` };
}

const bindsOn = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    // only "in use" means taken: a Mac without IPv6 can't bind :: at all, which says nothing about the port
    server.once("error", (e: NodeJS.ErrnoException) => resolve(e.code !== "EADDRINUSE"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });

/**
 * Whether a dev server could listen on `port` right now, whichever address it binds: the check lsof can't
 * make for another user's sockets. On macOS a bind only collides with the same address, so all four are tried.
 */
async function canBind(port: number): Promise<boolean> {
  for (const host of ["0.0.0.0", "::", "127.0.0.1", "::1"]) if (!(await bindsOn(port, host))) return false;
  return true;
}

/**
 * A free port for a coding agent, held for `minutes` so no other request gets it before its server
 * listens. Free means: nothing listens on it in a fresh scan, nothing else holds it, and it binds.
 */
export async function reserveFreePort(change: Record<string, unknown>): Promise<{ port?: number; until?: string; error?: string }> {
  const who = typeof change.for === "string" ? change.for.trim() : "";
  if (!who || who.length > RESERVE_FOR_MAX) return { error: `for must say who it is for, at most ${RESERVE_FOR_MAX} characters` };
  const minutes = change.minutes === undefined ? RESERVE_MINUTES : Number(change.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > RESERVE_MAX_MINUTES) {
    return { error: `minutes must be a whole number from 1 to ${RESERVE_MAX_MINUTES}` };
  }
  const preferred = change.preferred === undefined ? undefined : Number(change.preferred);
  if (preferred !== undefined && !(Number.isInteger(preferred) && preferred >= 1024 && preferred <= 65535)) {
    return { error: "preferred must be a whole number from 1024 to 65535" };
  }
  const snap = await collectSnapshot();
  if (snap.partial) return { error: "The scan missed some ports just now; try again" };
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const port = await reservePort({ for: who, until }, new Set(snap.ports.map((p) => p.port)), canBind, preferred);
  return port ? { port, until } : { error: "No free port from 3000 to 9999" };
}

/** Give a reserved port back. */
export async function releasePort(port: number): Promise<{ error?: string }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port must be a whole number from 1 to 65535" };
  if (!(await readPortPrefs())[port]?.reserved) return { error: `:${port} isn't reserved` };
  await setPortPref(port, { reserved: undefined });
  return {};
}

/** Pin, hide, watch or annotate a port number. Only booleans and a short note are stored. */
export async function updatePortPref(port: number, change: Record<string, unknown>): Promise<{ error?: string }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port must be a whole number from 1 to 65535" };
  if (change.note !== undefined && (typeof change.note !== "string" || change.note.length > NOTE_MAX)) {
    return { error: `note must be text of at most ${NOTE_MAX} characters` };
  }
  for (const k of ["pinned", "hidden", "watched"] as const) {
    if (change[k] !== undefined && typeof change[k] !== "boolean") return { error: `${k} must be true or false` };
  }
  await setPortPref(port, {
    ...(change.pinned !== undefined && { pinned: change.pinned as boolean }),
    ...(change.hidden !== undefined && { hidden: change.hidden as boolean }),
    ...(change.watched !== undefined && { watched: change.watched as boolean }),
    ...(change.note !== undefined && { note: (change.note as string).trim() }),
  });
  return {};
}
