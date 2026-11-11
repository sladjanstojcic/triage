import assert from "node:assert/strict";
import { test } from "node:test";
import { type AttentionItem, attentionItems, newAlerts } from "./attention";
import type { RemoteSnapshot, Snapshot } from "./collect/types";
import { findConflicts } from "./grouping";

const G = 1e9;
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  at: "",
  hostname: "mbpro",
  ports: [],
  processes: [],
  containers: [],
  ssh: [],
  tunnels: [],
  machine: { hostname: "mbpro", cores: 10, load: [2, 2, 2], disk: { used: 300 * G, total: 500 * G, mount: "/" } },
  errors: [],
  ...over,
});

test("a calm machine needs nothing", () => {
  assert.deepEqual(attentionItems(snap(), [], new Map()), []);
});

test("full disk, swap and Docker space are flagged; errors sort first", () => {
  const s = snap({
    machine: {
      hostname: "mbpro",
      disk: { used: 475 * G, total: 494 * G, mount: "/" },
      swap: { used: 21 * G, total: 22 * G },
    },
    dockerDisk: [{ type: "Images", count: 48, active: 24, size: 34 * G, reclaimable: 18 * G }],
  });
  const items = attentionItems(s, [], new Map());
  assert.deepEqual(items.map((i) => [i.level, i.text]), [
    ["error", "Disk 96% full"],
    ["error", "Swap 95% used"],
    ["warn", "Docker can free 18.0 GB"],
  ]);
});

test("the Docker item says how much cleanup frees and what it keeps", () => {
  const disk = (rows: [string, number][]) =>
    attentionItems(snap({ dockerDisk: rows.map(([type, r]) => ({ type, count: 1, active: 0, size: r, reclaimable: r })) }), [], new Map())
      .find((i) => i.key.endsWith(":reclaim"));
  assert.equal(disk([["Images", 18 * G], ["Build Cache", 4 * G]])?.detail, "unused images and build cache");
  assert.equal(
    disk([["Images", 18 * G], ["Local Volumes", 3 * G]])?.detail,
    "18.0 GB in unused images and build cache; 3.0 GB in volumes and stopped containers, which cleanup keeps",
  );
  const volumesOnly = disk([["Local Volumes", 12 * G]]);
  assert.match(volumesOnly!.detail!, /volumes/);
  assert.equal(volumesOnly!.prune, undefined);
});

test("shared ports, closed launchers, exposed ports", () => {
  const port = (p: number, pid: number, address = "127.0.0.1") =>
    ({ port: p, address, ownerKind: "process", pid, processName: "node", owner: "next", system: false }) as Snapshot["ports"][number];
  const ports = [port(4099, 1, "*"), port(4099, 2)];
  const s = snap({
    ports,
    processes: [
      {
        pid: 3, ppid: 1, name: "node", command: "next dev", elapsed: "1:00", cpu: 0, memMB: 10, system: false, stopPid: 3, stopTree: { pids: [3], cpu: 0, memMB: 10 },
        listens: [{ address: "127.0.0.1", port: 4545 }],
        project: { root: "/x", name: "agent-sessions", isWorktree: false },
        origin: { detached: true, agent: "Claude Code" },
      },
    ],
  });
  const items = attentionItems(s, [], findConflicts(ports));
  assert.deepEqual(items.map((i) => [i.text, i.detail, i.tab, i.stopPid]), [
    [":4099 is bound by 2 processes", "node, node", "projects", undefined],
    [":4545 has no launcher left", "agent-sessions · started by Claude Code", "projects", 3],
    ["1 port is open to your network", ":4099", "ports", undefined],
  ]);
});

test("remote: unreachable host, deleted stack folder", () => {
  const host = (over: Partial<RemoteSnapshot>): RemoteSnapshot => ({
    id: 1, name: "dev-vps", sshTarget: "dev-vps", ok: true, listeners: [], containers: [], at: "", ...over,
  });
  const items = attentionItems(snap(), [
    host({ name: "down", ok: false, error: "timeout" }),
    host({
      containers: [{
        id: "a", name: "db", image: "pg", state: "running", status: "Up", ports: [], group: "old-stack", kind: "compose",
        project: { root: "/gone", name: "gone", isWorktree: false, missing: true },
      }],
    }),
  ], new Map());
  assert.deepEqual(items.map((i) => [i.machine, i.text]), [
    ["down", "Unreachable over ssh"],
    ["dev-vps", "old-stack runs from a deleted folder"],
  ]);
});

test("a detached ssh tunnel points at the SSH tab, not its folder", () => {
  const s = snap({
    ssh: [{ pid: 9, target: "dev-vps", role: "tunnel", forwards: [], listens: [], elapsed: "1:00", command: "ssh -f", stopPid: 9 }],
    processes: [
      {
        pid: 9, ppid: 1, name: "ssh", command: "ssh -f -N", elapsed: "1:00", cpu: 0, memMB: 1, system: false, stopPid: 9, stopTree: { pids: [9], cpu: 0, memMB: 1 },
        listens: [{ address: "127.0.0.1", port: 28080 }],
        project: { root: "/x", name: "triage-app", isWorktree: false },
        origin: { detached: true },
      },
    ],
  });
  assert.deepEqual(attentionItems(s, [], new Map()).map((i) => [i.detail, i.tab, i.stopPid]), [["ssh tunnel to dev-vps", "ssh", undefined]]);
});

test("forgotten servers: a day old and idle, one item per server, services and busy servers left out", () => {
  type Proc = Snapshot["processes"][number];
  const proc = (pid: number, stopPid: number, port: number, over: Partial<Proc> = {}): Proc => ({
    pid, ppid: stopPid, name: "node", command: "node", elapsed: "2-03:00:00", cpu: 0, memMB: 100, system: false, stopPid,
    stopTree: { pids: [stopPid, pid], cpu: 0.2, memMB: 1536 },
    listens: [{ address: "127.0.0.1", port }],
    project: { root: "/x", name: "shop", isWorktree: false },
    origin: { detached: false, agent: "Claude Code", app: "herdr" },
    ...over,
  });
  const processes = [
    proc(11, 10, 3000), // two ports of one `next dev`
    proc(12, 10, 3001),
    proc(21, 20, 4000, { elapsed: "05:00:00" }), // only five hours old
    proc(31, 30, 5000, { stopTree: { pids: [30, 31], cpu: 12, memMB: 400 } }), // busy
    proc(41, 40, 5432, { origin: { detached: false, app: "launchd" } }), // brew services postgres
    proc(51, 50, 6000, { project: undefined }), // not in a project
    proc(61, 60, 9010, { command: "node ~/.npm/_npx/6ddf/node_modules/@browsermcp/mcp/dist/daemon.js" }), // an agent's MCP server
  ];
  const ports = processes.map((p) => ({
    port: p.listens[0].port, address: "127.0.0.1", ownerKind: "process", pid: p.pid, processName: "node", owner: "node", system: false, stopPid: p.stopPid,
  })) as Snapshot["ports"];
  const items = attentionItems(snap({ processes, ports }), [], new Map());
  assert.deepEqual(items.map((i) => [i.level, i.text, i.detail, i.stopPid]), [
    ["info", ":3000 :3001 idle, up 2d 3h", "shop · started by Claude Code in herdr · holds 1.5 GB", 10],
  ]);
});

test("a server the dashboard can't stop (itself) is never called forgotten", () => {
  const p = {
    pid: 7, ppid: 1, name: "node", command: "tsx watch src/server/index.ts", elapsed: "3-00:00:00", cpu: 0, memMB: 90, system: false, stopPid: 7,
    stopTree: { pids: [7], cpu: 0, memMB: 90 },
    listens: [{ address: "127.0.0.1", port: 4777 }],
    project: { root: "/t", name: "triage-app", isWorktree: false },
    origin: { detached: false, app: "herdr" },
  };
  const port = { port: 4777, address: "127.0.0.1", ownerKind: "process", pid: 7, processName: "node", owner: "tsx", system: false } as Snapshot["ports"][number];
  assert.deepEqual(attentionItems(snap({ processes: [p], ports: [port] }), [], new Map()), []);
});

test("newAlerts: new errors, warnings and forgotten servers once; not other info, not what was already there", () => {
  const item = (key: string, level: AttentionItem["level"]): AttentionItem => ({ key, level, machine: "mbpro", text: key });
  const items = [
    item("mbpro:shared:3000", "error"),
    item("mbpro:disk", "warn"),
    item("mbpro:exposed", "info"),
    item("mbpro:forgotten:42", "info"),
  ];
  const announced = new Map<string, number>();
  const keys = (list: AttentionItem[]) => list.map((i) => i.key);
  assert.deepEqual(keys(newAlerts(items, new Set(["mbpro:disk"]), announced, 1000)), ["mbpro:shared:3000", "mbpro:forgotten:42"]);
  // gone for one scan and back within half an hour: not announced again
  assert.deepEqual(keys(newAlerts(items, new Set(), announced, 1000 + 60_000)), ["mbpro:disk"]);
  // back after half an hour: announced again
  assert.deepEqual(keys(newAlerts(items.slice(0, 1), new Set(), announced, 1000 + 31 * 60_000)), ["mbpro:shared:3000"]);
});
