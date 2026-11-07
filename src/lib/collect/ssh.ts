import { run } from "@/lib/exec";
import type { PsRow } from "./local";
import type { Forward, LocalProcess, SshConnection } from "./types";

// ssh(1) options that take an argument; autossh adds -M.
const WITH_ARG = new Set("BbcDEeFIiJLlmOoPpQRSWwM".split(""));

type Parsed = { target?: string; opts: Map<string, string[]> };

export function parseSshArgs(tokens: string[]): Parsed {
  const opts = new Map<string, string[]>();
  const add = (k: string, v: string) => opts.set(k, [...(opts.get(k) ?? []), v]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("-") || t === "-") return { target: t, opts };
    // grouped flags like -NfT, or -L8080:localhost:80 with the value attached
    for (let j = 1; j < t.length; j++) {
      const f = t[j];
      if (WITH_ARG.has(f)) {
        const rest = t.slice(j + 1);
        add(f, rest || tokens[++i] || "");
        break;
      }
      add(f, "");
    }
  }
  return { opts };
}

const port = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

/**
 * Take a forward spec apart: "[bind:]port:host:hostport" for -L/-R ("bind:port → host:hostport" when it
 * comes from ~/.ssh/config), "[bind:]port" for -D. Unix-socket forwards keep only their spec.
 */
export function parseForward(f: Forward): Forward {
  const parts = f.spec.replace(/\s*→\s*|\s+/, ":").replace(/[[\]]/g, "").split(":");
  if (f.kind === "D") return { ...f, localPort: port(parts.at(-1)), bind: parts.length > 1 ? parts[0] : undefined };
  if (parts.length < 3) return f;
  const [bind, opened, destHost, destPort] = parts.length >= 4 ? parts.slice(-4) : [undefined, ...parts];
  const sides = { bind: bind || undefined, destHost, destPort: port(destPort) };
  return f.kind === "L" ? { ...f, ...sides, localPort: port(opened) } : { ...f, ...sides, remotePort: port(opened) };
}

function forwardsFrom(opts: Map<string, string[]>): Forward[] {
  const out: Forward[] = [];
  for (const k of ["L", "R", "D"] as const) for (const spec of opts.get(k) ?? []) out.push({ kind: k, spec });
  for (const o of opts.get("o") ?? []) {
    const m = o.match(/^(LocalForward|RemoteForward|DynamicForward)[= ](.+)$/i);
    if (m) out.push({ kind: m[1][0].toUpperCase() as Forward["kind"], spec: m[2].trim() });
  }
  return out;
}

/** Forwards and host details that live in ~/.ssh/config rather than on the command line. */
async function sshConfig(target: string, opts: Map<string, string[]>) {
  const args = ["-G"];
  for (const k of ["F", "p", "l"]) for (const v of opts.get(k) ?? []) args.push(`-${k}`, v);
  args.push(target);
  const res = await run("ssh", args, 3000);
  const cfg = { forwards: [] as Forward[], hostname: undefined as string | undefined, user: undefined as string | undefined, port: undefined as string | undefined };
  for (const line of res.stdout.split("\n")) {
    const [key, ...rest] = line.split(" ");
    const val = rest.join(" ");
    if (key === "hostname") cfg.hostname = val;
    else if (key === "user") cfg.user = val;
    else if (key === "port") cfg.port = val;
    else if (key === "localforward") cfg.forwards.push({ kind: "L", spec: val.replace(/\[|\]/g, "").replace(" ", " → ") });
    else if (key === "remoteforward") cfg.forwards.push({ kind: "R", spec: val.replace(/\[|\]/g, "").replace(" ", " → ") });
    else if (key === "dynamicforward") cfg.forwards.push({ kind: "D", spec: val.replace(/\[|\]/g, "") });
  }
  return cfg;
}

function isSsh(cmd: string) {
  const exe = cmd.split(" ")[0];
  return /(^|\/)(ssh|autossh)$/.test(exe) || /^ssh: .*\[mux\]/.test(cmd);
}

export async function collectSsh(ps: Map<number, PsRow>, listening: LocalProcess[]): Promise<SshConnection[]> {
  // skip the ssh probes this server itself spawns for remote hosts
  const rows = [...ps.values()].filter((r) => isSsh(r.command) && r.ppid !== process.pid);
  const autossh = new Set(rows.filter((r) => /(^|\/)autossh$/.test(r.command.split(" ")[0])).map((r) => r.pid));
  const childOf = new Set(rows.filter((r) => autossh.has(r.ppid)).map((r) => r.ppid));

  const out = await Promise.all(
    rows.map(async (r): Promise<SshConnection | undefined> => {
      const isAuto = autossh.has(r.pid);
      if (isAuto && childOf.has(r.pid)) return undefined; // shown via its ssh child

      // ControlMaster background process: "ssh: /path/to/socket [mux]"
      if (r.command.startsWith("ssh: ")) {
        const sock = r.command.slice(5).replace(/\s*\[mux\]$/, "");
        return {
          pid: r.pid, target: sock.split("/").pop() ?? sock, role: "multiplexed", forwards: [], listens: [],
          elapsed: r.elapsed, command: r.command, stopPid: r.pid,
        };
      }

      const { target, opts } = parseSshArgs(r.command.split(/\s+/).slice(1));
      if (!target) return undefined;
      const cfg = await sshConfig(target, opts);
      const forwards = [...forwardsFrom(opts), ...cfg.forwards].map(parseForward);
      const listens = listening.find((p) => p.pid === r.pid)?.listens ?? [];
      const role: SshConnection["role"] =
        forwards.length > 0 || opts.has("N") ? "tunnel" : opts.has("S") ? "multiplexed" : "session";
      return {
        pid: r.pid,
        target,
        user: cfg.user,
        hostname: cfg.hostname,
        port: cfg.port,
        role,
        managedBy: isAuto ? "autossh (reconnecting)" : autossh.has(r.ppid) ? `autossh (pid ${r.ppid})` : undefined,
        forwards,
        listens,
        elapsed: r.elapsed,
        command: r.command,
        stopPid: autossh.has(r.ppid) ? r.ppid : r.pid,
      };
    }),
  );
  return out.filter((c): c is SshConnection => !!c);
}
