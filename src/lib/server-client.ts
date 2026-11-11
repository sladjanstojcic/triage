/**
 * The Triage HTTP API from outside a browser: the menu bar (src/desktop/tray.ts) and the `triage` CLI.
 * State-changing routes want a same-origin request (api() in src/server/index.ts), so posts send the
 * server's own Origin, as the dashboard's page does.
 */
import type { PortPref, RemoteSnapshot, Snapshot } from "@/lib/collect/types";

export const DEFAULT_URL = `http://127.0.0.1:${process.env.PORT ?? 4777}`;

export function triageClient(baseUrl: string) {
  async function call<T>(route: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { origin: baseUrl, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(`Triage isn't running at ${baseUrl}. Open the app, or run pnpm start.`);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }
  return {
    snapshot: () => call<Snapshot>("/api/snapshot"),
    remote: () => call<RemoteSnapshot[]>("/api/remote"),
    stopProcess: (pid: number, force = false) => call<object>("/api/stop", { pid, force }),
    stopContainers: (ids: string[]) => call<object>("/api/containers", { action: "stop", ids }),
    setPortPref: (port: number, change: PortPref) => call<object>("/api/ports/pref", { port, ...change }),
    reservePort: (body: { for: string; preferred?: number; minutes?: number }) =>
      call<{ port: number; until: string }>("/api/ports/reserve", body),
    releasePort: (port: number) => call<object>("/api/ports/release", { port }),
  };
}
