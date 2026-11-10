/** Display helpers shared by every view. Pure functions: safe on server and client. */

/** "/Users/me/x" or "/home/me/x" → "~/x", anywhere in a path or command line. */
export function tildify(text: string): string {
  return text.replace(/\/(Users|home)\/[^/\s]+/g, "~");
}

const ETIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/;

/** ps etime "[[dd-]hh:]mm:ss" → seconds; undefined when it isn't one. */
export function elapsedSeconds(etime: string): number | undefined {
  const m = etime.match(ETIME);
  return m ? ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]) : undefined;
}

/** ps etime "[[dd-]hh:]mm:ss" → "3d 4h" / "2h 5m" / "12m" */
export function humanElapsed(etime: string): string {
  const m = etime.match(ETIME);
  if (!m) return etime;
  const [d, h, min] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3])];
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${min}m`;
  return `${min}m`;
}

/** Bound to every interface, so reachable from the LAN / tailnet. */
export function isExposed(address: string) {
  return address === "*" || address === "0.0.0.0" || address === "::";
}

/** localhost, 127.x or ::1. */
export function isLoopback(host: string) {
  return host === "localhost" || host.startsWith("127.") || host === "::1";
}

/** Wildcard/loopback binds are reachable as localhost. */
export function localUrl(address: string, port: number) {
  const host =
    isExposed(address) || isLoopback(address)
      ? "localhost"
      : address.includes(":")
        ? `[${address}]`
        : address;
  return `http://${host}:${port}`;
}

/** The search box: does any text in `value` contain `query`, ignoring case? An empty query matches. */
export function matches(value: unknown, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || JSON.stringify(value).toLowerCase().includes(needle);
}

/** "1 port" / "3 ports" / "" for zero */
export function count(n: number, word: string) {
  return n === 0 ? "" : `${n} ${word}${n === 1 ? "" : "s"}`;
}

// A path that may contain spaces ("~/Desktop/GRIP DB/…") but never crosses into a flag (" -x").
const PATH = String.raw`(?:~|/)(?:\S|\s(?!-))*?`;
// …/bin/x, …/sbin/x, …/libexec/x, …/bin/darwin-arm64/x, …/node_modules/.bin/x
const BIN_PATH = new RegExp(
  String.raw`(^|\s)${PATH}/(?:node_modules/\.bin/(?:\.\./\S*/)?|(?:s?bin|libexec)/(?:[\w-]+-(?:arm64|x64|x86_64|amd64)/)?)([\w.@+-]+)(?=\s|$)`,
  "g",
);
// /Applications/Zed.app/Contents/MacOS/zed → zed
const APP_PATH = new RegExp(String.raw`(^|\s)${PATH}\.app(?:ex)?/Contents/MacOS/`, "g");
const PACKAGE_PATH = new RegExp(String.raw`(^|\s)${PATH}/node_modules/(?=[@\w])`, "g");
const LOADER_FLAG = /\s--(?:require|import|loader|experimental-loader)[\s=]\S+/g;
// drop the interpreter only in front of an installed CLI: keep it before a script file or a flag (-m, -e)
const RUNTIME = /^(?:node|bun|deno|python\d*(?:\.\d+)?)\s+(?!-)(?![\w./~-]+\.(?:[cm]?[jt]s|py)\b)/;

/**
 * The command as you'd type it: binaries without their install path, no node loader flags, no
 * interpreter in front of a CLI. "node ~/app/node_modules/.bin/next dev -p 4545" → "next dev -p 4545".
 * Expects an already tildified command.
 */
export function shortCommand(cmd: string): string {
  return cmd
    .replace(APP_PATH, "$1")
    .replace(BIN_PATH, "$1$2")
    .replace(PACKAGE_PATH, "$1")
    .replace(LOADER_FLAG, "")
    .replace(RUNTIME, "")
    .trim();
}

/**
 * `uptime` output → "up 4d 44m · load 0.51".
 * "10:10:55 up 4 days, 44 min, 4 users, load average: 0.51, 0.39, 0.38"; also "up 3:12," and "up 12 min,".
 */
export function shortUptime(raw: string): string {
  const up = raw.match(/up\s+(.*?),\s+\d+\s+users?/)?.[1] ?? raw.match(/up\s+(.*?),\s+load/)?.[1];
  const load = raw.match(/load averages?:\s*([\d.]+)/)?.[1];
  if (!up) return raw;
  const days = up.match(/(\d+)\s+days?/)?.[1];
  const hm = up.match(/(\d+):(\d+)/);
  const mins = up.match(/(\d+)\s+min/)?.[1];
  const parts = [days && `${days}d`, hm && `${Number(hm[1])}h`, (hm?.[2] ?? mins) && `${Number(hm?.[2] ?? mins)}m`];
  return [`up ${parts.filter(Boolean).join(" ")}`, load && `load ${load}`].filter(Boolean).join(" · ");
}

/** Bytes as "21.4 GB". `binary` for memory and swap (macOS shows 16 GB of RAM), decimal for disks. */
export function formatBytes(n: number, binary = false): string {
  const k = binary ? 1024 : 1000;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= k && i < units.length - 1) {
    n /= k;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Memory in MiB (ps, docker stats) as "850 MB" / "1.4 GB". */
export const formatMem = (mb: number) => formatBytes(mb * 1024 ** 2, true);

/** Time since an ISO date as "1d 2h" / "3h 5m" / "12m". */
export function since(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  const [d, h, m] = [Math.floor(mins / 1440), Math.floor((mins % 1440) / 60), mins % 60];
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
