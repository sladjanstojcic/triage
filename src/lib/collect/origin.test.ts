import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOrigin, parseOriginEnv, processChain, type ProcRow } from "./origin";

const table = (rows: [number, number, string, string][]) =>
  new Map(rows.map(([pid, ppid, tty, command]): [number, ProcRow] => [pid, { pid, ppid, tty, command }]));

const origin = (rows: [number, number, string, string][], pid: number, env: Record<string, string> = {}) =>
  describeOrigin(processChain(pid, table(rows)), env);

test("macOS: dev server whose agent session closed → agent, app, terminal, launcher gone", () => {
  const rows: [number, number, string, string][] = [
    [1, 0, "??", "/sbin/launchd"],
    [100, 1, "??", "npm run dev"],
    [101, 100, "??", "/bin/sh ~/.volta/tools/image/npm/11/bin/npm run dev"],
    [102, 101, "??", "node ~/app/node_modules/.bin/next dev -p 4545"],
    [103, 102, "??", "next-server (v16.4.5)"],
  ];
  const env = parseOriginEnv("next-server TERM_PROGRAM=ghostty __CFBundleIdentifier=dev.herdr.app CLAUDECODE=1 XPC_SERVICE_NAME=0");
  assert.deepEqual(origin(rows, 103, env), { app: "herdr", terminal: "Ghostty", agent: "Claude Code", detached: true });
});

test("macOS: started from an editor that is still open", () => {
  const rows: [number, number, string, string][] = [
    [649, 1, "??", "/Applications/Zed.app/Contents/MacOS/zed"],
    [700, 649, "ttys004", "/bin/zsh -l"],
    [701, 700, "ttys004", "node ~/x/node_modules/.bin/next dev -p 4099"],
  ];
  assert.deepEqual(origin(rows, 701, { __CFBundleIdentifier: "dev.zed.Zed", TERM_PROGRAM: "zed" }), { app: "Zed", detached: false });
});

test("macOS: agent background service is not a closed launcher", () => {
  const rows: [number, number, string, string][] = [
    [68122, 1, "??", "~/.codex/packages/app-server-daemon/releases/0.167.0/bin/codex"],
    [83902, 68122, "??", "~/.local/share/uv/tools/serena/bin/python ~/.local/bin/serena start-mcp-server"],
  ];
  assert.deepEqual(origin(rows, 83902, { __CFBundleIdentifier: "dev.herdr.app", TERM_PROGRAM: "ghostty" }), {
    app: "herdr",
    terminal: "Ghostty",
    agent: "Codex",
    detached: false,
  });
});

test("an agent serving a port itself is not reported as its own launcher", () => {
  const rows: [number, number, string, string][] = [
    [643, 1, "??", "/Applications/Herdr.app/Contents/MacOS/Herdr"],
    [73809, 643, "ttys002", "codex --yolo resume"],
  ];
  assert.deepEqual(origin(rows, 73809), { app: "herdr", detached: false });
});

test("macOS: launchd job", () => {
  const rows: [number, number, string, string][] = [[500, 1, "??", "node dist/server.mjs"]];
  assert.deepEqual(origin(rows, 500, { XPC_SERVICE_NAME: "dev.triage.app" }), { app: "launchd", detached: false });
});

test("Linux: dev server in a live ssh session, under tmux, run by Claude Code", () => {
  const rows: [number, number, string, string][] = [
    [1, 0, "?", "/sbin/init"],
    [900, 1, "?", "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"],
    [950, 1, "?", "tmux new -s dev"],
    [951, 950, "pts/3", "-bash"],
    [952, 951, "pts/3", "node /home/me/.local/bin/claude"],
    [953, 952, "pts/3", "node /srv/app/node_modules/.bin/next dev -p 3001"],
  ];
  assert.deepEqual(origin(rows, 953, { TMUX: "/tmp/tmux-1000/default,950,0" }), { app: "tmux", agent: "Claude Code", detached: false });
});

test("Linux: orphan adopted by systemd --user is a closed launcher; a systemd unit is not", () => {
  const rows: [number, number, string, string][] = [
    [1, 0, "?", "/sbin/init"],
    [1200, 1, "?", "/usr/lib/systemd/systemd --user"],
    [1300, 1200, "?", "npm run dev"],
    [1301, 1300, "?", "node /srv/app/node_modules/.bin/vite"],
  ];
  assert.deepEqual(origin(rows, 1301), { detached: true });
  assert.deepEqual(origin(rows, 1301, { INVOCATION_ID: "abc" }), { app: "systemd", detached: false });
});

test("Linux: VS Code remote server", () => {
  const rows: [number, number, string, string][] = [
    [1, 0, "?", "/sbin/init"],
    [400, 1, "?", "sh /home/me/.vscode-server/cli/servers/Stable-x/server/bin/code-server --start-server"],
    [401, 400, "pts/1", "/bin/bash"],
    [402, 401, "pts/1", "python3 manage.py runserver"],
  ];
  assert.deepEqual(origin(rows, 402), { app: "VS Code (remote)", detached: false });
});

test("nothing known: no origin", () => {
  assert.equal(origin([[10, 1, "ttys001", "python3 -m http.server"]], 10), undefined);
});
