import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContainerSummary, LocalProcess, PortRow, RemoteSnapshot } from "./collect/types";
import { localTunnel, remoteTarget, sshMachines, sshUser, usageOf, visibleContainers } from "./grouping";

const host = {
  id: 1,
  name: "dev-vps",
  sshTarget: "dev-vps",
  resolvedHost: "dev-vps.tail.ts.net",
  ok: true,
  listeners: [{ address: "127.0.0.1", port: 55121, container: "kong", system: false }],
  containers: [],
  at: "",
} satisfies RemoteSnapshot;

const forward = (port: number, sshHost: string, remotePort: number): PortRow => ({
  port,
  address: "127.0.0.1",
  ownerKind: "ssh",
  pid: 9,
  processName: "ssh",
  owner: `dev-vps-ports → localhost:${remotePort}`,
  sshHost,
  remotePort,
  system: false,
});

test("localTunnel: finds the local forward to that host and port, by resolved HostName", () => {
  const ports = [forward(3001, "dev-vps.tail.ts.net", 3001), forward(15121, "dev-vps.tail.ts.net", 55121)];
  assert.equal(localTunnel(host, 55121, ports)?.port, 15121);
  assert.equal(localTunnel(host, 4010, ports), undefined);
});

test("localTunnel: ignores forwards to other hosts", () => {
  assert.equal(localTunnel(host, 55121, [forward(55121, "other-box", 55121)]), undefined);
});

test("remoteTarget: the same match from the local side", () => {
  assert.equal(remoteTarget(forward(55121, "dev-vps", 55121), [host])?.listener.container, "kong");
});

const conn = (pid: number, target: string, role: "tunnel" | "multiplexed" | "session", hostname?: string) => ({
  pid, target, role, hostname, user: "me", forwards: [], listens: [], elapsed: "1:00", command: "ssh", stopPid: pid,
});

test("sshMachines: aliases of one machine group together, named after the probed host, tunnels first", () => {
  const m = sshMachines(
    [conn(1, "dev-vps", "multiplexed", "dev-vps.tail.ts.net"), conn(2, "dev-vps-ports", "tunnel", "dev-vps.tail.ts.net"), conn(3, "gh", "session", "github.com")],
    [host],
  );
  assert.deepEqual(m.map((x) => [x.name, x.address, x.connections.map((c) => c.pid)]), [
    ["dev-vps", "me@dev-vps.tail.ts.net", [2, 1]],
    ["github", "me@github.com", [3]],
  ]);
});

test("sshUser: names the tool behind a shared connection", () => {
  assert.equal(sshUser("ssh -S ~/.local/state/herdr-core/default/ssh-x -T dev-vps sh -c 'exec herdr-core'"), "herdr");
  assert.equal(sshUser("ssh -T host ~/.vscode-server/bin/code-server"), "VS Code");
  assert.equal(sshUser("ssh host"), undefined);
});

test("visibleContainers: running, stopped members of a live stack, recently stopped; not old leftovers", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const c = (name: string, state: string, group?: string, stoppedAt?: string): ContainerSummary => ({
    id: name, name, image: "x", state, status: state, ports: [], kind: group ? "compose" : "container", group, stoppedAt,
  });
  const shown = visibleContainers(
    [
      c("web", "running", "app"),
      c("worker", "exited", "app", "2026-10-01T00:00:00Z"),
      c("db", "exited", "old-stack", "2026-11-07T09:00:00Z"),
      c("cache", "exited", "older-stack", "2026-11-01T00:00:00Z"),
      c("scratch", "exited", undefined, "2026-10-20T00:00:00Z"),
    ],
    now,
  );
  assert.deepEqual(shown.map((x) => x.name), ["web", "worker", "db"]);
});

test("usageOf: one server counts once with its whole tree, plus its containers", () => {
  const proc = (pid: number, stopPid: number) =>
    ({ pid, stopPid, stopTree: { pids: [stopPid, pid], cpu: 2.5, memMB: 1200 } }) as LocalProcess;
  const port = (p: number, pid: number) => ({ port: p, pid, ownerKind: "process" }) as PortRow;
  const docker = { port: 54321, pid: 9, ownerKind: "docker" } as PortRow;
  assert.deepEqual(
    usageOf([port(3000, 11), port(3001, 12), docker], [{ cpu: 0.5, memMB: 300 }, {}], [proc(11, 10), proc(12, 10)]),
    { cpu: 3, memMB: 1500 },
  );
});
