/**
 * What protocol a listening port speaks: http, https, a database, ssh… Databases are known by what runs
 * them (probing one would only fill its log with bad-handshake errors); anything else gets one short
 * look in the background: a TLS handshake, then a plain HTTP request. Results are kept per process, so a
 * port is looked at once for as long as the same process holds it.
 */
import net from "node:net";
import tls from "node:tls";
import type { Protocol } from "./types";


const BY_HINT: [RegExp, Protocol][] = [
  [/postgres|supabase_db_/i, "postgres"],
  [/mysql|mariadb/i, "mysql"],
  [/redis|valkey/i, "redis"],
  [/mongo/i, "mongodb"],
];

/** The protocol a database port speaks, from its tech, command or container image; undefined for anything else. */
export function protocolFromHint(hint: string): Protocol | undefined {
  // PostgREST and postgres-meta (Supabase) serve HTTP, whatever their names say
  if (/postgrest|postgres-meta/i.test(hint)) return undefined;
  return BY_HINT.find(([re]) => re.test(hint))?.[1];
}

/** What the first bytes a server sends (a banner, or its answer to a plain HTTP request) say it speaks. */
export function classifyReply(reply: string): Protocol | undefined {
  if (/^HTTP\/\d/.test(reply)) return "http";
  if (reply.startsWith("SSH-")) return "ssh";
  if (/^220[ -]/.test(reply)) return "smtp";
  if (reply.startsWith("+OK")) return "pop3";
  if (reply.startsWith("* OK")) return "imap";
  return undefined;
}

const PROBE_MS = 3000;
// An HTTP parser turns this down with a 400 straight away (bad Content-Length), before any route runs: a
// dev server answers without compiling a page, and nothing in the app sees the request.
const REQUEST = (port: number) => `HEAD / HTTP/1.1\r\nHost: localhost:${port}\r\nUser-Agent: Triage\r\nContent-Length: x\r\n\r\n`;
// A port that answered neither HTTP nor TLS may have been busy (a server still starting): look again later.
const QUIET_RECHECK_MS = 5 * 60_000;

/** Send a plain HTTP HEAD and read what comes back (or the banner a server sends first). */
function plainReply(port: number, host: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let data = "";
    const done = () => {
      socket.destroy();
      resolve(data);
    };
    socket.setTimeout(PROBE_MS, done);
    socket.on("connect", () => socket.write(REQUEST(port)));
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      if (data.length >= 16) done();
    });
    socket.on("error", done);
    socket.on("end", done);
  });
}

/** Whether a TLS handshake succeeds, and whether HTTP answers behind it. */
function tlsReply(port: number, host: string): Promise<Protocol | undefined> {
  return new Promise((resolve) => {
    // a local dev certificate is self-signed or for another name; only the handshake matters here
    const socket = tls.connect({ port, host, rejectUnauthorized: false, servername: "localhost", ALPNProtocols: ["http/1.1"] });
    let secure = false;
    let data = "";
    const done = () => {
      socket.destroy();
      resolve(secure ? (classifyReply(data) === "http" ? "https" : "tls") : undefined);
    };
    socket.setTimeout(PROBE_MS, done);
    socket.on("secureConnect", () => {
      secure = true;
      socket.write(REQUEST(port));
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      if (data.length >= 16) done();
    });
    socket.on("error", done);
    socket.on("end", done);
  });
}

/**
 * TLS first: an HTTPS server answers a plain request with "400 Bad Request" too, so a plain look would call
 * it http. A plain server turns the TLS handshake down and gets the plain look.
 */
export async function probe(port: number, host: string): Promise<Protocol> {
  return (await tlsReply(port, host)) ?? classifyReply(await plainReply(port, host)) ?? "tcp";
}

const known = new Map<string, { protocol: Protocol; at: number }>();
const pending = new Set<string>();

/**
 * The protocol of `port` held by `pid`, from a database hint or an earlier look; undefined while the first
 * look runs in the background (the next scan has it). `host` is where to connect: a wildcard bind is
 * reached on loopback.
 */
export function cachedProtocol(pid: number, port: number, address: string, hint: string): Protocol | undefined {
  const fromHint = protocolFromHint(hint);
  if (fromHint) return fromHint;
  const key = `${pid}:${port}`;
  const hit = known.get(key);
  if (pending.has(key) || (hit && (hit.protocol !== "tcp" || Date.now() - hit.at < QUIET_RECHECK_MS))) return hit?.protocol;
  // pids and ports change over a long session; a fresh start costs one more look per port
  if (known.size > 2000) known.clear();
  pending.add(key);
  const host = address === "*" || address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "::1" : address;
  void probe(port, host)
    .then((protocol) => known.set(key, { protocol, at: Date.now() }))
    .finally(() => pending.delete(key));
  return hit?.protocol;
}
