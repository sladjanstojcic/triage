import assert from "node:assert/strict";
import { test } from "node:test";
import type { Container, LocalProcess, PortRow, Snapshot } from "./collect/types";
import { portReports, stopPlan } from "./report";

const row = (port: number, pid: number, over: Partial<PortRow> = {}): PortRow => ({
  port, address: "127.0.0.1", ownerKind: "process", pid, processName: "node", owner: "next-server (v16)", system: false, ...over,
});

const proc = (pid: number, over: Partial<LocalProcess> = {}): LocalProcess => ({
  pid, ppid: 1, name: "node", command: "next-server", elapsed: "1:00", cpu: 0, memMB: 100, listens: [], system: false,
  stopPid: pid, stopTree: { pids: [pid], cpu: 0, memMB: 100 }, ...over,
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  at: "", hostname: "mbpro", ports: [], processes: [], containers: [], ssh: [], tunnels: [], machine: { hostname: "mbpro" }, errors: [], ...over,
});

const shop = { root: "/Users/me/shop", name: "shop", branch: "main", isWorktree: false };

const next = snap({
  ports: [
    row(3000, 101, { stopPid: 100, project: shop, folder: "/Users/me/shop" }),
    row(3000, 101, { address: "::1", stopPid: 100, project: shop }),
    row(3001, 101, { stopPid: 100, project: shop }),
    row(22, 50, { processName: "sshd", system: true }),
  ],
  processes: [
    proc(101, {
      stopPid: 100,
      parentCommand: "node /Users/me/shop/node_modules/.bin/next dev",
      origin: { agent: "Claude Code", app: "Zed", detached: false },
      stopTree: { pids: [100, 101, 102], cpu: 1, memMB: 900 },
    }),
  ],
});

test("portReports: one line per port and owner, the dev command, who started it; system ports only with all", () => {
  const ports = portReports(next);
  assert.deepEqual(ports.map((p) => p.port), [3000, 3001]);
  assert.equal(ports[0].owner, "next dev");
  assert.equal(ports[0].command, "node ~/shop/node_modules/.bin/next dev");
  assert.equal(ports[0].startedBy, "Claude Code · Zed");
  assert.equal(ports[0].folder, "~/shop");
  assert.equal(ports[0].stoppable, true);
  assert.deepEqual(portReports(next, true).map((p) => [p.port, p.stoppable]), [[22, false], [3000, true], [3001, true]]);
});

test("stopPlan: a dev server stops through its CLI, and says what else goes down", () => {
  const plan = stopPlan(next, 3000);
  assert.deepEqual(plan.target, { pid: 100 });
  assert.equal(plan.title, "Kill :3000 (shop)");
  assert.match(plan.action!, /pid 100, the dev CLI/);
  assert.deepEqual(plan.alsoGoesDown, ["1 more port: :3001", "2 more processes of this server (dev CLI, workers, watchers)"]);
});

test("stopPlan: refuses system ports, empty ports and ports two owners share", () => {
  assert.match(stopPlan(next, 22).error!, /sshd/);
  assert.match(stopPlan(next, 9999).error!, /Nothing is listening/);
  const shared = snap({ ports: [row(4099, 1, { stopPid: 1 }), row(4099, 2, { stopPid: 2 })] });
  assert.match(stopPlan(shared, 4099).error!, /2 owners/);
  // the listing agrees: `triage stop 4099` would refuse, so neither owner is stoppable
  assert.deepEqual(portReports(shared).map((p) => p.stoppable), [false, false]);
});

test("stopPlan: a container's port stops the container", () => {
  const db = { id: "99f91cf2463f", name: "db", image: "postgres:17", state: "running" } as Container;
  const s = snap({ ports: [row(5432, 9, { ownerKind: "docker", containerId: db.id, processName: "com.docker" })], containers: [db] });
  assert.deepEqual(stopPlan(s, 5432).target, { containerIds: ["99f91cf2463f"] });
  assert.equal(stopPlan(s, 5432).title, "Stop container db");
});
