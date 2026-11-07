import { addHost, listHosts, removeHost } from "@/lib/hosts";
import { run } from "@/lib/exec";
import { SSH_TARGET_RE } from "@/lib/ssh-target";
import { probeRemote } from "@/lib/collect/remote";
import { collectSnapshot } from "@/lib/collect/snapshot";
import type { ContainerSummary } from "@/lib/collect/types";
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
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return {};
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { error: code === "EPERM" ? `No permission to stop pid ${pid} (owned by another user)` : String(e) };
  }
}

export type ContainerAction = "start" | "stop" | "restart";

/** Which containers an action applies to: stop and restart need it up, start needs it stopped. */
function actionable(action: ContainerAction, containers: ContainerSummary[], ids: string[]) {
  const ok = new Set(containers.filter((c) => (action === "start" ? !isUp(c) : isUp(c))).map((c) => c.id));
  return ids.filter((id) => /^[0-9a-f]{12,64}$/.test(id) && ok.has(id));
}

const NOT_ACTIONABLE: Record<ContainerAction, string> = {
  start: "Those containers are already running or gone",
  stop: "Those containers are no longer running",
  restart: "Those containers are no longer running",
};

/** docker start / stop / restart on this Mac, for containers a fresh scan shows in the right state. */
export async function containerAction(action: ContainerAction, ids: string[]): Promise<{ error?: string }> {
  const valid = actionable(action, (await collectSnapshot()).containers, ids);
  if (valid.length === 0) return { error: NOT_ACTIONABLE[action] };
  const res = await run("docker", [action, ...valid], 90_000);
  return res.ok ? {} : { error: res.stderr.trim().slice(0, 300) || `docker ${action} failed` };
}

/** Run a fixed command on a remote host over ssh; callers only interpolate validated ids and numbers. */
function onHost(sshTarget: string, command: string) {
  return run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", sshTarget, command], 90_000);
}

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
