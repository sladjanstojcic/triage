// Browser side of the state-changing endpoints in src/server/index.ts.

import type { ContainerAction, LogLine, PortPref } from "@/lib/collect/types";

async function post<T extends { error?: string } = { error?: string }>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return res.ok ? data : ({ error: data.error ?? `HTTP ${res.status}` } as T);
  } catch (e) {
    return { error: `Triage server unreachable: ${e instanceof Error ? e.message : String(e)}` } as T;
  }
}

export const addRemoteHost = (sshTarget: string) => post("/api/hosts", { sshTarget });
export const removeRemoteHost = (id: number) => post("/api/hosts/remove", { id });
export const stopProcess = (pid: number, force = false) => post("/api/stop", { pid, force });
/** docker start / stop / restart, on this Mac or (with hostId) on a remote host */
export const containerAction = (action: ContainerAction, ids: string[], hostId?: number) =>
  hostId === undefined ? post("/api/containers", { action, ids }) : post("/api/remote/containers", { hostId, action, ids });
export const stopRemoteProcess = (hostId: number, pid: number, force = false) => post("/api/remote/stop", { hostId, pid, force });
/** The last lines of a container's log, on this Mac or (with hostId) on a remote host */
export const containerLogs = (id: string, hostId?: number) => post<{ lines?: LogLine[]; error?: string }>("/api/logs", { id, hostId });
/** Delete unused Docker images and build cache, on this Mac or (with hostId) on a remote host */
export const dockerPrune = (hostId?: number) => post<{ reclaimed?: string; error?: string }>("/api/docker/prune", { hostId });
/** Pin, hide or annotate a port number */
export const setPortPref = (port: number, change: PortPref) => post("/api/ports/pref", { port, ...change });
