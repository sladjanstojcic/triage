import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { run } from "@/lib/exec";
import { childIndex, describeOrigin, parseOriginEnv, processChain, processTree, stopPidFor } from "./origin";
import type { ListenAddr, LocalProcess, ProcessTree, ProjectInfo } from "./types";

export type PsRow = { pid: number; ppid: number; elapsed: string; cpu: number; memMB: number; tty: string; command: string };

/** Every process on the machine, from one `ps` call. */
export async function listProcesses(): Promise<Map<number, PsRow>> {
  // tdev, not tty: tty makes ps look up every terminal name (~15x slower); tdev is "??" without a terminal
  const res = await run("ps", ["-axww", "-o", "pid=,ppid=,etime=,pcpu=,rss=,tdev=,command="]);
  const rows = new Map<number, PsRow>();
  for (const line of res.stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.set(Number(m[1]), {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      elapsed: m[3],
      cpu: Number(m[4]),
      memMB: Math.round(Number(m[5]) / 1024),
      tty: m[6],
      command: m[7],
    });
  }
  return rows;
}

/** A process and its descendants, with their CPU and memory added up. */
export function treeUsage(pid: number, ps: Map<number, PsRow>, children: Map<number, number[]>): ProcessTree {
  const pids = processTree(pid, children);
  const rows = pids.flatMap((p) => ps.get(p) ?? []);
  return {
    pids,
    cpu: Math.round(rows.reduce((sum, r) => sum + r.cpu, 0) * 10) / 10,
    memMB: rows.reduce((sum, r) => sum + r.memMB, 0),
  };
}

/** Parse `lsof -F` output into per-pid records. */
function parseLsofFields(out: string) {
  const byPid = new Map<number, { name: string; names: string[] }>();
  let cur: { name: string; names: string[] } | undefined;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      const pid = Number(val);
      cur = byPid.get(pid) ?? { name: "", names: [] };
      byPid.set(pid, cur);
    } else if (cur && tag === "c") cur.name = val;
    else if (cur && tag === "n") cur.names.push(val);
  }
  return byPid;
}

export function parseAddr(name: string): ListenAddr | undefined {
  const i = name.lastIndexOf(":");
  if (i < 0) return undefined;
  const port = Number(name.slice(i + 1));
  if (!Number.isFinite(port)) return undefined;
  // "[fd7a::1]%tailscale0" / "100.1.2.3%tailscale0" → strip zone and brackets
  return { address: name.slice(0, i).replace(/%[^\]]*$/, "").replace(/^\[|\]$/g, ""), port };
}

/** Collapse IPv4/IPv6 duplicates of the same port into one address list. */
function dedupeListens(addrs: ListenAddr[]): ListenAddr[] {
  const seen = new Map<number, ListenAddr>();
  for (const a of addrs) {
    const prev = seen.get(a.port);
    // prefer the widest bind: * > 0.0.0.0 > 127.0.0.1 > ::1
    const rank = (x: string) => (x === "*" ? 0 : x === "0.0.0.0" || x === "::" ? 1 : x.includes(".") ? 2 : 3);
    if (!prev || rank(a.address) < rank(prev.address)) seen.set(a.port, a);
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

const TECH: [RegExp, string][] = [
  [/next-server|\bnext\b (dev|start)|\/next\/dist|\.bin\/next/, "Next.js"],
  [/\bvite\b(?!\.config)/, "Vite"],
  [/\bastro\b/, "Astro"],
  [/\bnuxt/, "Nuxt"],
  [/\bremix\b|react-router dev/, "Remix"],
  [/storybook/, "Storybook"],
  [/expo|metro/, "Expo/Metro"],
  [/wrangler|workerd/, "Wrangler"],
  [/webpack/, "Webpack"],
  [/\bbun\b/, "Bun"],
  [/\bdeno\b/, "Deno"],
  [/uvicorn|fastapi/, "Uvicorn"],
  [/manage\.py runserver|django/, "Django"],
  [/flask/, "Flask"],
  [/gunicorn/, "Gunicorn"],
  [/rails|puma/, "Rails"],
  [/php-fpm|php -S|artisan serve/, "PHP"],
  [/postgres/, "Postgres"],
  [/mysqld|mariadb/, "MySQL"],
  [/redis-server/, "Redis"],
  [/mongod\b/, "MongoDB"],
  [/nginx/, "nginx"],
  [/mailpit|mailhog/, "Mail"],
  [/Application Support\/Local\//, "Local WP"],
  [/serena/, "Serena MCP"],
  [/\bcodex\b/, "Codex"],
  [/\bclaude\b/, "Claude"],
  [/python/, "Python"],
  [/\bnode\b|\/node /, "Node"],
];

function detectTech(text: string): string | undefined {
  for (const [re, label] of TECH) if (re.test(text)) return label;
  return undefined;
}

/** Desktop apps and OS daemons that listen on ports but aren't things you're developing. */
function isSystem(command: string, cwd?: string): boolean {
  if (/Application Support\/Local\//.test(command)) return false;
  if (/^\/(System|usr\/libexec|usr\/sbin|sbin)\//.test(command)) return true;
  if (/^\/Applications\/[^/]+\.app\//.test(command) && (!cwd || cwd === "/" || cwd.includes("/Library/Containers/"))) return true;
  return false;
}

// Git lookups are the slowest part of a poll; cache per folder briefly.
const projectCache = new Map<string, { at: number; info: Promise<ProjectInfo | undefined> }>();
const PROJECT_TTL_MS = 15_000;

function findUp(start: string, marker: string): string | undefined {
  let dir = start;
  while (true) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function projectFor(dir: string | undefined): Promise<ProjectInfo | undefined> {
  if (!dir || dir === "/" || !dir.startsWith("/")) return undefined;
  const hit = projectCache.get(dir);
  if (hit && Date.now() - hit.at < PROJECT_TTL_MS) return hit.info;
  // the pending lookup is cached, so containers and processes in one folder share a single git call
  const info = lookupProject(dir);
  for (const [k, v] of projectCache) if (Date.now() - v.at >= PROJECT_TTL_MS) projectCache.delete(k);
  projectCache.set(dir, { at: Date.now(), info });
  return info;
}

async function lookupProject(dir: string): Promise<ProjectInfo | undefined> {
  let info: ProjectInfo | undefined;
  if (!existsSync(dir)) {
    // the process is still running inside a folder that was removed (e.g. a deleted worktree)
    info = { root: dir, name: path.basename(dir), isWorktree: false, missing: true };
  } else {
    const git = await run("git", [
      "-C", dir, "rev-parse", "--path-format=absolute",
      "--show-toplevel", "--git-dir", "--git-common-dir", "--abbrev-ref", "HEAD",
    ], 3000);
    const pkgDir = findUp(dir, "package.json") ?? findUp(dir, "pyproject.toml");
    if (git.ok) {
      const [root, gitDir, commonDir, branch] = git.stdout.trim().split("\n");
      const isWorktree = !!gitDir && !!commonDir && path.resolve(gitDir) !== path.resolve(commonDir);
      const mainRepo = isWorktree ? path.dirname(path.resolve(commonDir)) : undefined;
      // monorepo app folder, e.g. "apps/web"
      const sub = pkgDir && pkgDir.startsWith(root) ? path.relative(root, pkgDir) : "";
      info = {
        root,
        name: isWorktree && mainRepo ? `${path.basename(mainRepo)} / ${path.basename(root)}` : path.basename(root),
        subpath: sub || undefined,
        branch: branch === "HEAD" ? "(detached)" : branch,
        isWorktree,
        mainRepo,
      };
    } else {
      const root = pkgDir ?? dir;
      if (root !== process.env.HOME) info = { root, name: path.basename(root), isWorktree: false };
    }
  }
  return info;
}

// Local (WordPress, by WP Engine) runs each site's services from .../Local/run/<siteId>/
const LOCAL_RUN = /Application Support\/Local\/run\/([A-Za-z0-9_-]+)\//;
let localSites: { at: number; sites: Record<string, { name: string; path: string }> } | undefined;

/** The Local WP site a process serves; null for Local's shared router (no site), undefined when not Local. */
function localWpProject(text: string): ProjectInfo | null | undefined {
  const id = text.match(LOCAL_RUN)?.[1];
  if (!id) return undefined;
  if (id === "router") return null;
  if (!localSites || Date.now() - localSites.at > 60_000) {
    try {
      const file = path.join(process.env.HOME ?? "", "Library/Application Support/Local/sites.json");
      localSites = { at: Date.now(), sites: JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      localSites = { at: Date.now(), sites: {} };
    }
  }
  const site = localSites.sites[id];
  if (!site) return { root: "", name: `Local WP ${id}`, isWorktree: false };
  return { root: site.path.replace(/^~/, process.env.HOME ?? "~"), name: `${site.name} (Local WP)`, isWorktree: false };
}

async function localProject(text: string, cwd: string | undefined) {
  const wp = localWpProject(text);
  return wp === null ? undefined : (wp ?? (await projectFor(cwd)));
}

// A process's launch environment never changes, so read it once per process (pid + command, in case
// the pid is reused).
const envCache = new Map<string, Record<string, string>>();

/** The ORIGIN_ENV variables of each pid, from one `ps eww` call for the ones not seen before. */
async function launchEnvs(pids: number[], ps: Map<number, PsRow>): Promise<Map<number, Record<string, string>>> {
  const key = (pid: number) => `${pid}:${ps.get(pid)?.command ?? ""}`;
  const missing = pids.filter((pid) => !envCache.has(key(pid)));
  if (missing.length > 0) {
    const res = await run("ps", ["eww", "-o", "pid=,command=", "-p", missing.join(",")]);
    const byPid = new Map(res.stdout.split("\n").map((line) => [Number(line.match(/^\s*(\d+)/)?.[1]), line] as const));
    for (const pid of missing) envCache.set(key(pid), parseOriginEnv(byPid.get(pid) ?? ""));
  }
  const live = new Set(pids.map(key));
  for (const k of envCache.keys()) if (!live.has(k)) envCache.delete(k);
  return new Map(pids.map((pid) => [pid, envCache.get(key(pid))!]));
}

/**
 * The launch environment of the nearest process in the chain that still shows one: a process that sets
 * its title (next-server, nginx workers) overwrites the memory `ps` reads the environment from.
 */
function launchEnv(chain: { pid: number }[], envs: Map<number, Record<string, string>>) {
  return chain.map((r) => envs.get(r.pid) ?? {}).find((env) => Object.keys(env).length > 0) ?? {};
}

/** Every process with a listening TCP socket, enriched with its folder, project and who started it. */
export async function collectListeningProcesses(psRows: Promise<Map<number, PsRow>>): Promise<{ procs: LocalProcess[]; error?: string }> {
  // lsof doesn't need ps, so both run at once
  const [res, ps] = await Promise.all([run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]), psRows]);
  // lsof exits 1 when it finds nothing; treat empty output as "no listeners", not an error.
  if (!res.ok && !res.stdout) return { procs: [], error: res.stderr.trim() || undefined };
  const listeners = parseLsofFields(res.stdout);
  const pids = [...listeners.keys()];
  if (pids.length === 0) return { procs: [] };

  const chains = new Map(pids.map((pid) => [pid, processChain(pid, ps)]));
  const [cwdRes, envs] = await Promise.all([
    run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"]),
    launchEnvs([...new Set([...chains.values()].flat().map((r) => r.pid))], ps),
  ]);
  const cwds = parseLsofFields(cwdRes.stdout);
  const children = childIndex(ps);

  const procs = await Promise.all(
    pids.map(async (pid): Promise<LocalProcess> => {
      const l = listeners.get(pid)!;
      const row = ps.get(pid);
      const parent = row ? ps.get(row.ppid) : undefined;
      const cwd = cwds.get(pid)?.names[0];
      const command = row?.command ?? l.name;
      const parentCommand = parent && parent.pid > 1 ? parent.command : undefined;
      const system = isSystem(command, cwd);
      const stopPid = stopPidFor(pid, ps);
      return {
        pid,
        ppid: row?.ppid ?? 0,
        name: l.name,
        command,
        parentCommand,
        cwd,
        elapsed: row?.elapsed ?? "",
        cpu: row?.cpu ?? 0,
        memMB: row?.memMB ?? 0,
        listens: dedupeListens(l.names.map(parseAddr).filter((a): a is ListenAddr => !!a)),
        tech: detectTech(`${command} ${parentCommand ?? ""}`),
        system,
        stopPid,
        stopTree: treeUsage(stopPid, ps, children),
        project: system ? undefined : await localProject(`${command} ${cwd ?? ""}`, cwd),
        origin: system ? undefined : describeOrigin(chains.get(pid)!, launchEnv(chains.get(pid)!, envs)),
      };
    }),
  );
  // Workers that share the parent's socket (nginx workers, next dev → next-server) aren't separate listeners.
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  for (const p of procs) {
    const parent = byPid.get(p.ppid);
    if (parent) p.listens = p.listens.filter((l) => !parent.listens.some((pl) => pl.port === l.port));
  }
  return { procs: procs.filter((p) => p.listens.length > 0).sort((a, b) => (a.listens[0]?.port ?? 0) - (b.listens[0]?.port ?? 0)) };
}
