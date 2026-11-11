import assert from "node:assert/strict";
import { test } from "node:test";
import type { PortRow, RemoteSnapshot, Snapshot } from "./collect/types";
import { containerImpact, impactLines, processImpact, remoteImpact, targetPort } from "./impact";

const row = (port: number, pid: number, over: Partial<PortRow> = {}): PortRow => ({
  port, address: "127.0.0.1", ownerKind: "process", pid, processName: "node", owner: "node", system: false, ...over,
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  at: "", hostname: "mbpro", ports: [], processes: [], containers: [], ssh: [], tunnels: [], machine: { hostname: "mbpro" }, errors: [], ...over,
});

test("targetPort reads the local port of a tunnel target, and ignores other hosts", () => {
  assert.equal(targetPort("http://localhost:3000"), 3000);
  assert.equal(targetPort("http://127.0.0.1:3000/api"), 3000);
  assert.equal(targetPort("127.0.0.1:5432"), 5432);
  assert.equal(targetPort("3000"), 3000);
  assert.equal(targetPort("https+insecure://[::1]:8443"), 8443);
  assert.equal(targetPort("http://192.168.1.5:3000"), undefined);
  assert.equal(targetPort("/var/www"), undefined);
  assert.equal(targetPort(undefined), undefined);
});

test("stopping `next dev` takes its server's ports, its workers, and the tunnels and -R forwards to them", () => {
  const s = snap({
    processes: [
      {
        pid: 101, ppid: 100, name: "node", command: "next-server", elapsed: "1:00", cpu: 0, memMB: 900, system: false, stopPid: 100,
        stopTree: { pids: [100, 101, 102, 103], cpu: 1, memMB: 1200 }, listens: [{ address: "127.0.0.1", port: 3000 }],
      },
    ],
    ports: [row(3000, 101, { stopPid: 100 }), row(3001, 103, { stopPid: 100 }), row(5432, 200, { stopPid: 200 })],
    tunnels: [
      { kind: "cloudflared", pid: 300, detail: "", target: "http://localhost:3000", publicUrl: "https://x.trycloudflare.com" },
      { kind: "tailscale serve", detail: "tailnet only", target: "http://127.0.0.1:5432" },
    ],
    ssh: [
      {
        pid: 400, target: "dev-vps", role: "tunnel", elapsed: "1:00", command: "ssh -R", stopPid: 400, listens: [],
        forwards: [
          { kind: "R", spec: "9000:localhost:3001", remotePort: 9000, destHost: "localhost", destPort: 3001 },
          { kind: "L", spec: "3000:localhost:3000", localPort: 3000, destHost: "localhost", destPort: 3000 },
        ],
      },
    ],
  });
  const impact = processImpact(s, 100);
  assert.deepEqual(impact.ports.map((r) => r.port), [3000, 3001]);
  // the dev CLI (100) and one worker (102) don't listen
  assert.equal(impact.otherProcesses, 2);
  assert.deepEqual(impact.tunnels.map((t) => t.kind), ["cloudflared"]);
  // an -L forward opens a port here, it doesn't lead to one
  assert.deepEqual(impact.reverseForwards, [{ target: "dev-vps", spec: "9000:localhost:3001" }]);
});

test("a tunnel client inside the tree being stopped isn't listed as left behind", () => {
  const s = snap({
    processes: [
      {
        pid: 2, ppid: 1, name: "node", command: "node", elapsed: "1:00", cpu: 0, memMB: 1, system: false, stopPid: 1,
        stopTree: { pids: [1, 2, 3], cpu: 0, memMB: 1 }, listens: [{ address: "127.0.0.1", port: 3000 }],
      },
    ],
    ports: [row(3000, 2, { stopPid: 1 })],
    tunnels: [{ kind: "ngrok", pid: 3, detail: "", target: "localhost:3000" }],
  });
  assert.deepEqual(processImpact(s, 1).tunnels, []);
});

test("stopping containers: their published ports and the tunnels to them", () => {
  const s = snap({
    ports: [row(54321, 9, { ownerKind: "docker", containerId: "abc123abc123" }), row(54322, 9, { ownerKind: "docker", containerId: "def" })],
    tunnels: [{ kind: "tailscale funnel", detail: "public internet", target: "http://127.0.0.1:54321" }],
  });
  const impact = containerImpact(s, ["abc123abc123"]);
  assert.deepEqual(impact.ports.map((r) => r.port), [54321]);
  assert.deepEqual(impact.tunnels.map((t) => t.kind), ["tailscale funnel"]);
});

test("stopping something on a VPS: the local ssh -L forwards to its ports", () => {
  const host = { id: 1, name: "dev-vps", sshTarget: "dev-vps", resolvedHost: "1.2.3.4", ok: true, listeners: [], containers: [], at: "" } as RemoteSnapshot;
  const local = [
    row(15432, 50, { ownerKind: "ssh", sshHost: "1.2.3.4", remotePort: 5432 }),
    row(18080, 51, { ownerKind: "ssh", sshHost: "other", remotePort: 8080 }),
  ];
  assert.deepEqual(remoteImpact(host, [5432, 8080], local).map((r) => r.port), [15432]);
  assert.deepEqual(remoteImpact(undefined, [5432], local), []);
});

test("impactLines: the other ports once each, the rest of the tree, and what points at nothing", () => {
  const lines = impactLines(
    {
      ports: [row(3000, 101), row(3000, 101, { address: "::1" }), row(3001, 102)],
      otherProcesses: 2,
      tunnels: [{ kind: "cloudflared", detail: "", publicUrl: "https://x.trycloudflare.com" }],
      reverseForwards: [{ target: "vps", spec: "8080:localhost:3000" }],
    },
    3000,
    [row(15432, 900, { ownerKind: "ssh", sshTarget: "vps" })],
  );
  assert.deepEqual(lines, [
    "1 more port: :3001",
    "2 more processes of this server (dev CLI, workers, watchers)",
    "cloudflared https://x.trycloudflare.com stops working",
    "ssh -R 8080:localhost:3000 on vps stops working",
    "local tunnel :15432 (ssh vps) leads nowhere",
  ]);
  assert.deepEqual(impactLines(undefined), []);
});
