import assert from "node:assert/strict";
import { test } from "node:test";
import type { PortRow, Snapshot } from "./collect/types";
import { compare, diff, listeners, type PortEvent, stateAt } from "./history";

const row = (port: number, pid: number, over: Partial<PortRow> = {}): PortRow => ({
  port, address: "127.0.0.1", ownerKind: "process", pid, processName: "node", owner: "vite", system: false, ...over,
});
const snap = (ports: PortRow[]): Snapshot => ({
  at: "", hostname: "mbpro", ports, processes: [], containers: [], ssh: [], tunnels: [], machine: { hostname: "mbpro" }, errors: [],
});

test("listeners: one per port and owner, system services left out", () => {
  const l = listeners(snap([row(5173, 1), row(5173, 1, { address: "::1" }), row(22, 2, { system: true })]));
  assert.deepEqual([...l.keys()], ["5173/1"]);
  assert.equal(l.get("5173/1")?.what, "vite");
});

test("diff: stopped ports, then started ones; a restart with a new pid is both", () => {
  const before = listeners(snap([row(3000, 1), row(5173, 2)]));
  const after = listeners(snap([row(3000, 9), row(5173, 2)]));
  assert.deepEqual(diff(before, after, "t").map((e) => `${e.up ? "up" : "down"} ${e.key}`), ["down 3000/1", "up 3000/9"]);
  assert.deepEqual(diff(after, after, "t"), []);
});

test("stateAt and compare: what ran then and not now, and what is new", () => {
  const ev = (at: string, up: boolean, port: number): PortEvent => ({ at, up, key: `${port}/1`, port, what: "x" });
  const events = [ev("08:00", true, 3000), ev("08:30", true, 4000), ev("10:00", false, 3000), ev("11:00", true, 5000)];
  assert.deepEqual([...stateAt(events, "09:00").keys()], ["3000/1", "4000/1"]);
  const now = stateAt(events, "12:00");
  const { gone, started } = compare(events, "09:00", now);
  assert.deepEqual(gone.map((l) => [l.port, l.stoppedAt]), [[3000, "10:00"]]);
  assert.deepEqual(started.map((l) => l.port), [5000]);
});
