import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { collectSnapshot } from "@/lib/collect/snapshot";
import type { ContainerAction } from "@/lib/collect/types";
import {
  addRemoteHost,
  containerAction,
  containerLogs,
  dockerPrune,
  releasePort,
  reserveFreePort,
  updatePortPref,
  probeRemoteHosts,
  remoteContainerAction,
  removeRemoteHost,
  stopProcess,
  stopRemoteProcess,
} from "./actions";
import { history, record } from "./history-store";

const ACTIONS: ContainerAction[] = ["start", "stop", "restart", "pause", "unpause"];

/** Requests that arrive while `fn` runs (another tab, a poll overlapping a slow scan) share its result. */
function shared<T>(fn: () => Promise<T>) {
  let running: Promise<T> | undefined;
  return () => (running ??= fn().finally(() => (running = undefined)));
}
// each scan the dashboard asks for is compared with the one before, for the History tab
const snapshot = shared(async () => {
  const snap = await collectSnapshot();
  void record(snap);
  return snap;
});
const remote = shared(probeRemoteHosts);

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4777);
const PROD = process.env.NODE_ENV === "production";
// Production bundle lives at dist/server.mjs next to dist/client; dev serves the project root through Vite.
const CLIENT_DIR = path.join(import.meta.dirname, "client");

// Only these Host headers are served, so a web page can't reach this server through DNS rebinding.
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // falls through to the 400 below
  }
  throw new HttpError(400, "Expected a JSON object");
}

/** Returns false when the request isn't an API route. */
async function api(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const route = `${req.method} ${pathname}`;
  if (route === "GET /api/snapshot") return json(res, 200, await snapshot()), true;
  if (route === "GET /api/remote") return json(res, 200, await remote()), true;
  if (route === "GET /api/history") return json(res, 200, await history("")), true;
  if (!pathname.startsWith("/api/")) return false;

  // Everything below changes state. A cross-site page can't send a same-origin Origin header, and
  // requiring JSON forces a CORS preflight that this server never answers.
  if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, "Cross-origin request refused");
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "Expected application/json");
  const body = await readJson(req);

  if (route === "POST /api/hosts") {
    if (typeof body.sshTarget !== "string") throw new HttpError(400, "sshTarget must be a string");
    return json(res, 200, await addRemoteHost(body.sshTarget, typeof body.name === "string" ? body.name : undefined)), true;
  }
  if (route === "POST /api/hosts/remove") {
    if (typeof body.id !== "number") throw new HttpError(400, "id must be a number");
    await removeRemoteHost(body.id);
    return json(res, 200, {}), true;
  }
  if (route === "POST /api/stop") {
    if (typeof body.pid !== "number") throw new HttpError(400, "pid must be a number");
    return json(res, 200, await stopProcess(body.pid, body.force === true)), true;
  }
  if (route === "POST /api/containers" || route === "POST /api/remote/containers") {
    if (!ACTIONS.includes(body.action as ContainerAction)) throw new HttpError(400, "action must be start, stop, restart, pause or unpause");
    if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) {
      throw new HttpError(400, "ids must be an array of strings");
    }
    const action = body.action as ContainerAction;
    if (route === "POST /api/containers") return json(res, 200, await containerAction(action, body.ids)), true;
    if (typeof body.hostId !== "number") throw new HttpError(400, "hostId must be a number");
    return json(res, 200, await remoteContainerAction(body.hostId, action, body.ids)), true;
  }
  // read-only, but a container's logs can hold secrets, so it stays behind the Origin check
  if (route === "POST /api/logs") {
    if (typeof body.id !== "string") throw new HttpError(400, "id must be a string");
    if (body.hostId !== undefined && typeof body.hostId !== "number") throw new HttpError(400, "hostId must be a number");
    return json(res, 200, await containerLogs(body.id, body.hostId)), true;
  }
  if (route === "POST /api/ports/pref") {
    return json(res, 200, await updatePortPref(Number(body.port), body)), true;
  }
  if (route === "POST /api/ports/reserve") return json(res, 200, await reserveFreePort(body)), true;
  if (route === "POST /api/ports/release") return json(res, 200, await releasePort(Number(body.port))), true;
  if (route === "POST /api/docker/prune") {
    if (body.hostId !== undefined && typeof body.hostId !== "number") throw new HttpError(400, "hostId must be a number");
    return json(res, 200, await dockerPrune(body.hostId)), true;
  }
  if (route === "POST /api/remote/stop") {
    if (typeof body.hostId !== "number" || typeof body.pid !== "number") throw new HttpError(400, "hostId and pid must be numbers");
    return json(res, 200, await stopRemoteProcess(body.hostId, body.pid, body.force === true)), true;
  }
  throw new HttpError(404, "Not found");
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Production: files from dist/client, index.html for anything else. */
async function serveStatic(res: ServerResponse, pathname: string) {
  let file = path.join(CLIENT_DIR, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(CLIENT_DIR + path.sep) || !(await stat(file).catch(() => null))?.isFile()) {
    file = path.join(CLIENT_DIR, "index.html");
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    // Vite puts a content hash in every asset name
    "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}

const server = createServer();

const vite = PROD
  ? undefined
  : await (await import("vite")).createServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });

server.on("request", async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) throw new HttpError(403, "Unknown Host header");
    const { pathname } = new URL(req.url ?? "/", "http://x");
    if (await api(req, res, pathname)) return;
    if (vite) vite.middlewares(req, res);
    else await serveStatic(res, pathname);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
    else res.end();
  }
});

/** Settles once the port is bound or taken; the desktop app waits on it to open its window or explain the failure. */
export const listening = new Promise<string>((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`Triage running at ${url}${PROD ? "" : " (dev)"}`);
    resolve(url);
  });
});
