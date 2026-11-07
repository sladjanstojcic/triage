// Browser side of the state-changing endpoints in src/server/index.ts.

import type { ContainerAction } from "@/lib/collect/types";

async function post(url: string, body: unknown): Promise<{ error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? data : { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: `Triage server unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const addRemoteHost = (sshTarget: string, name?: string) => post("/api/hosts", { sshTarget, name });
export const removeRemoteHost = (id: number) => post("/api/hosts/remove", { id });
export const stopProcess = (pid: number, force = false) => post("/api/stop", { pid, force });
/** docker start / stop / restart, on this Mac or (with hostId) on a remote host */
export const containerAction = (action: ContainerAction, ids: string[], hostId?: number) =>
  hostId === undefined ? post("/api/containers", { action, ids }) : post("/api/remote/containers", { hostId, action, ids });
export const stopRemoteProcess = (hostId: number, pid: number, force = false) => post("/api/remote/stop", { hostId, pid, force });
