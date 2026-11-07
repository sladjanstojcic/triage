import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionItems } from "./attention";
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

test("shared ports, closed launchers, exposed ports", () => {
  const port = (p: number, pid: number, address = "127.0.0.1") =>
    ({ port: p, address, ownerKind: "process", pid, processName: "node", owner: "next", system: false }) as Snapshot["ports"][number];
  const ports = [port(4099, 1, "*"), port(4099, 2)];
  const s = snap({
    ports,
    processes: [
      {
        pid: 3, ppid: 1, name: "node", command: "next dev", elapsed: "1:00", cpu: 0, memMB: 10, system: false, stopPid: 3,
        listens: [{ address: "127.0.0.1", port: 4545 }],
        project: { root: "/x", name: "agent-sessions", isWorktree: false },
        origin: { detached: true, agent: "Claude Code" },
      },
    ],
  });
  const items = attentionItems(s, [], findConflicts(ports));
  assert.deepEqual(items.map((i) => [i.text, i.detail, i.tab]), [
    [":4099 is bound by 2 processes", "node, node", "projects"],
    [":4545 has no launcher left", "agent-sessions · started by Claude Code", "projects"],
    ["1 port is open to your network", ":4099", "ports"],
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
        pid: 9, ppid: 1, name: "ssh", command: "ssh -f -N", elapsed: "1:00", cpu: 0, memMB: 1, system: false, stopPid: 9,
        listens: [{ address: "127.0.0.1", port: 28080 }],
        project: { root: "/x", name: "triage-app", isWorktree: false },
        origin: { detached: true },
      },
    ],
  });
  assert.deepEqual(attentionItems(s, [], new Map()).map((i) => [i.detail, i.tab]), [["ssh tunnel to dev-vps", "ssh"]]);
});
