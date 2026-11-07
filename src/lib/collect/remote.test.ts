import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDockerPorts, parseLinuxMachine, parseStackFolders, stoppedAt } from "./remote";

test("parseDockerPorts: published only, IPv6 twin dropped, sorted", () => {
  assert.deepEqual(parseDockerPorts("8080/tcp, [::]:58322->5432/tcp, 0.0.0.0:58322->5432/tcp, 127.0.0.1:55121->8000/tcp"), [
    { hostIp: "127.0.0.1", hostPort: 55121, containerPort: 8000, proto: "tcp" },
    { hostIp: "::", hostPort: 58322, containerPort: 5432, proto: "tcp" },
  ]);
});

test("parseDockerPorts: port ranges expand pairwise", () => {
  assert.deepEqual(
    parseDockerPorts("0.0.0.0:8000-8001->9000-9001/tcp").map((p) => [p.hostPort, p.containerPort]),
    [[8000, 9000], [8001, 9001]],
  );
});

test("parseDockerPorts: internal only", () => assert.deepEqual(parseDockerPorts("8443-8444/tcp, 9999/tcp"), []));

test("parseStackFolders: repo root + subpath, worktree naming, deleted folder", () => {
  const p = parseStackFolders([
    "/home/me/code/inbox0/apps/web\t1\t/home/me/code/inbox0\tmain\t/home/me/code/inbox0/.git",
    "/home/me/wt/feat-x\t1\t/home/me/wt/feat-x\tfeat/x\t/home/me/code/inbox0/.git/worktrees/feat-x",
    "/home/me/gone/db\t\t\t\t",
  ]);
  assert.deepEqual(p.get("/home/me/code/inbox0/apps/web"), {
    root: "/home/me/code/inbox0", name: "inbox0", subpath: "apps/web", branch: "main", isWorktree: false, mainRepo: undefined, missing: undefined,
  });
  assert.equal(p.get("/home/me/wt/feat-x")?.name, "inbox0 / feat-x");
  assert.equal(p.get("/home/me/wt/feat-x")?.isWorktree, true);
  assert.deepEqual(p.get("/home/me/gone/db"), {
    root: "/home/me/gone/db", name: "db", subpath: undefined, branch: undefined, isWorktree: false, mainRepo: undefined, missing: true,
  });
});

test("parseLinuxMachine: /proc and df values", () => {
  const m = parseLinuxMachine(
    [
      "os=Ubuntu 24.04.4 LTS",
      "cores=4",
      "cpu= AMD EPYC-Milan Processor",
      "load=0.70 0.62 0.55 1/1438 4182252",
      "uptime=354087.59 1239966.68",
      "MemTotal:       15985092 kB",
      "MemAvailable:    8055728 kB",
      "SwapTotal:       4194300 kB",
      "SwapFree:        2492008 kB",
      "df=/dev/sda1        157149496 47233172 103499560      32% /",
    ],
    "dev-vps",
  );
  assert.equal(m.os, "Ubuntu 24.04.4 LTS");
  assert.equal(m.cpu, "AMD EPYC-Milan Processor");
  assert.equal(m.cores, 4);
  assert.deepEqual(m.load, [0.7, 0.62, 0.55]);
  assert.deepEqual(m.memory, { used: (15985092 - 8055728) * 1024, total: 15985092 * 1024 });
  assert.deepEqual(m.swap, { used: (4194300 - 2492008) * 1024, total: 4194300 * 1024 });
  assert.deepEqual(m.disk, { used: 47233172 * 1024, total: (47233172 + 103499560) * 1024, mount: "/" });
  assert.ok(m.bootedAt);
});

test("parseLinuxMachine: missing values stay undefined", () => {
  const m = parseLinuxMachine(["os=", "SwapTotal: 0 kB", "SwapFree: 0 kB"], "box");
  assert.equal(m.os, undefined);
  assert.equal(m.swap, undefined);
  assert.equal(m.memory, undefined);
});

test("stoppedAt: docker's relative exit times", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  assert.equal(stoppedAt("Exited (0) 2 hours ago", now), "2026-11-07T10:00:00.000Z");
  assert.equal(stoppedAt("Exited (1) About an hour ago", now), "2026-11-07T11:00:00.000Z");
  assert.equal(stoppedAt("Exited (143) 4 days ago", now), "2026-11-03T12:00:00.000Z");
  assert.equal(stoppedAt("Created", now), undefined);
});
