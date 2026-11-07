/**
 * Who started a listening process: the app or terminal it was launched from, the coding agent that ran
 * it, and whether that launcher is still around. Pure functions, used for this Mac (ps) and for remote
 * Linux hosts (ps + /proc); each collector supplies the process table and the listener's environment.
 */
import type { Origin } from "./types";

export type ProcRow = { pid: number; ppid: number; tty?: string; command: string };

/** Dev CLIs that spawn the actual server (`next dev` → next-server). */
const DEV_CLI = /\b(next|nuxt|astro|remix|vite|react-router)\b.*\b(dev|start|preview)\b/;

/** Stop the dev CLI (`next dev`) rather than the server it spawned, so it can't respawn or linger. */
export function stopPidFor(pid: number, table: Map<number, ProcRow>): number {
  const row = table.get(pid);
  const parent = row ? table.get(row.ppid) : undefined;
  return parent && parent.pid > 1 && DEV_CLI.test(parent.command) && !DEV_CLI.test(row!.command) ? parent.pid : pid;
}

/** Environment variables that say where a process was launched from; children inherit them. */
export const ORIGIN_ENV = ["__CFBundleIdentifier", "TERM_PROGRAM", "CLAUDECODE", "XPC_SERVICE_NAME", "INVOCATION_ID", "TMUX"];

/** Pick ORIGIN_ENV values out of `ps eww` output or a newline/space-separated environ dump. */
export function parseOriginEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ORIGIN_ENV) {
    const m = text.match(new RegExp(`(?:^|\\s)${key}=(\\S*)`));
    if (m) env[key] = m[1];
  }
  return env;
}

// A process whose parent is launchd/init, or the per-user systemd that adopts orphans on Linux, is the
// top of its launch chain.
const ADOPTER = /^(?:\S*\/)?(?:launchd|systemd --user|systemd\s*$)/;

/** The listener, its parent, … up to the top of its launch chain (the process just below launchd/init). */
export function processChain(pid: number, rows: Map<number, ProcRow>): ProcRow[] {
  const chain: ProcRow[] = [];
  for (let row = rows.get(pid); row && chain.length < 64; row = rows.get(row.ppid)) {
    chain.push(row);
    const parent = rows.get(row.ppid);
    if (row.ppid <= 1 || !parent || ADOPTER.test(parent.command)) break;
  }
  return chain;
}

const BUNDLES: Record<string, string> = {
  "dev.zed.Zed": "Zed",
  "dev.zed.Zed-Preview": "Zed",
  "dev.herdr.app": "herdr",
  "com.microsoft.VSCode": "VS Code",
  "com.microsoft.VSCodeInsiders": "VS Code",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "com.exafunction.windsurf": "Windsurf",
  "com.mitchellh.ghostty": "Ghostty",
  "com.googlecode.iterm2": "iTerm2",
  "com.apple.Terminal": "Terminal",
  "dev.warp.Warp-Stable": "Warp",
  "net.kovidgoyal.kitty": "kitty",
  "com.github.wez.wezterm": "WezTerm",
  "org.alacritty": "Alacritty",
  "com.openai.codex": "Codex",
  "com.anthropic.claudefordesktop": "Claude",
};

const TERMINALS: Record<string, string> = {
  ghostty: "Ghostty",
  "iTerm.app": "iTerm2",
  Apple_Terminal: "Terminal",
  WarpTerminal: "Warp",
  WezTerm: "WezTerm",
  vscode: "VS Code",
  zed: "Zed",
  tmux: "tmux",
  kitty: "kitty",
  Alacritty: "Alacritty",
};

// Launchers recognised in the chain itself; the first one above the listener names the app.
const CHAIN_APPS: [RegExp, string][] = [
  [/\/([^/]+)\.app\/Contents\/MacOS\//, "$app"],
  [/\.vscode-server\//, "VS Code (remote)"],
  [/\.cursor-server\//, "Cursor (remote)"],
  [/zed-remote-server|\.zed_server\//, "Zed (remote)"],
  [/herdr-core|\bherdr\b/i, "herdr"],
  [/^tmux\b|\/tmux\b/, "tmux"],
  [/^zellij\b|\/zellij\b/, "zellij"],
  [/^SCREEN\b|^screen\b/, "screen"],
  [/^sshd: /, "SSH session"],
];

// Coding agents, recognised by the program a chain entry runs.
const AGENTS: [RegExp, string][] = [
  [/(?:^|\/)claude$|@anthropic-ai\/claude-code/, "Claude Code"],
  [/(?:^|\/)codex$|@openai\/codex/, "Codex"],
  [/(?:^|\/)cursor-agent$/, "Cursor agent"],
  [/(?:^|\/)gemini$/, "Gemini CLI"],
  [/(?:^|\/)aider$/, "aider"],
  [/(?:^|\/)opencode$/, "opencode"],
];

// Tops of a chain that stay up on purpose: apps, autossh, multiplexers, ssh, agent daemons, container runtimes.
const LONG_LIVED = /\.app\/Contents\/MacOS\/|autossh|tmux|zellij|SCREEN|herdr|sshd|\.vscode-server|\.cursor-server|zed-remote-server|containerd|dockerd|(?:^|\/)(?:codex|claude)\b/;

/** The program and, for interpreters, the script it runs: "node /x/bin/claude --y" → ["node", "/x/bin/claude"]. */
function programs(command: string): string[] {
  const [first, second] = command.split(/\s+/);
  return /(?:^|\/)(?:node|bun|deno|python\d*(?:\.\d+)?)$/.test(first ?? "") && second ? [first, second] : [first ?? ""];
}

/** "Herdr" (from Herdr.app) → "herdr", the same name its bundle id maps to. */
function appName(bundleName: string): string {
  return Object.values(BUNDLES).find((n) => n.toLowerCase() === bundleName.toLowerCase()) ?? bundleName;
}

function appFromChain(chain: ProcRow[]): string | undefined {
  for (const row of chain.slice(1)) {
    for (const [re, name] of CHAIN_APPS) {
      const m = row.command.match(re);
      if (m) return name === "$app" ? appName(m[1]) : name;
    }
  }
}

export function describeOrigin(chain: ProcRow[], env: Record<string, string>): Origin | undefined {
  if (chain.length === 0) return undefined;
  const root = chain[chain.length - 1];
  const launchdJob = !!env.XPC_SERVICE_NAME && env.XPC_SERVICE_NAME !== "0";
  const systemdUnit = !!env.INVOCATION_ID;

  const app =
    appFromChain(chain) ??
    (launchdJob ? "launchd" : systemdUnit ? "systemd" : undefined) ??
    BUNDLES[env.__CFBundleIdentifier ?? ""] ??
    (env.TMUX ? "tmux" : undefined);
  const term = TERMINALS[env.TERM_PROGRAM ?? ""];
  // the listener itself being an agent (codex serving a port) says nothing about who started it
  const agent =
    chain
      .slice(1)
      .flatMap((r) => programs(r.command))
      .map((p) => AGENTS.find(([re]) => re.test(p))?.[1])
      .find(Boolean) ?? (env.CLAUDECODE === "1" ? "Claude Code" : undefined);

  const hasTty = !!root.tty && !/^\?+$/.test(root.tty);
  const detached = !hasTty && !launchdJob && !systemdUnit && !LONG_LIVED.test(root.command);

  const origin: Origin = { detached };
  if (app) origin.app = app;
  if (term && term !== app) origin.terminal = term;
  if (agent) origin.agent = agent;
  return origin.app || origin.terminal || origin.agent || detached ? origin : undefined;
}
