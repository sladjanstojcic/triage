import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeLogs, parseDockerStats, parseLogs, parseReclaimed } from "./docker";

test("parseDockerStats: CPU percent and used memory by short id", () => {
  const out = `{"CPUPerc":"0.45%","ID":"1d924cee908c","MemUsage":"200.9MiB / 2.91GiB","Name":"studio"}
{"CPUPerc":"112.30%","ID":"99f91cf2463f","MemUsage":"1.5GiB / 2.91GiB","Name":"db"}
{"CPUPerc":"--","ID":"aaaaaaaaaaaa","MemUsage":"-- / --","Name":"starting"}
not json`;
  assert.deepEqual([...parseDockerStats(out)], [
    ["1d924cee908c", { cpu: 0.45, memMB: 201 }],
    ["99f91cf2463f", { cpu: 112.3, memMB: 1536 }],
    ["aaaaaaaaaaaa", { cpu: 0, memMB: 0 }],
  ]);
});

test("parseLogs: timestamp and text per line, CR stripped, empty lines without a timestamp dropped, long lines cut", () => {
  const long = "x".repeat(5000);
  const out = `2026-11-11T09:00:00.000000001Z ready on :3000\r\n2026-11-11T09:00:01.5Z \n${long}\n\n`;
  const lines = parseLogs(out);
  assert.deepEqual(lines.slice(0, 2), [
    { at: "2026-11-11T09:00:00.000000001Z", text: "ready on :3000" },
    { at: "2026-11-11T09:00:01.5Z", text: "" },
  ]);
  assert.equal(lines[2].at, "2026-11-11T09:00:01.5Z");
  assert.equal(lines[2].text.length, 4002);
  assert.equal(lines.length, 3);
});

test("mergeLogs: stdout and stderr back in time order", () => {
  const stdout = "2026-11-11T09:00:00Z a\n2026-11-11T09:00:02Z c\n";
  const stderr = "2026-11-11T09:00:01Z b\n2026-11-11T09:00:02Z d\n";
  assert.deepEqual(mergeLogs(stdout, stderr).map((l) => l.text), ["a", "b", "c", "d"]);
});

test("parseReclaimed: image and build cache totals, nothing-freed parts left out", () => {
  assert.equal(parseReclaimed("Deleted Images:\nuntagged: x\n\nTotal reclaimed space: 1.234GB\nID\tRECLAIMABLE\nabc\ttrue\nTotal:\t300MB\n"), "1.234GB + 300MB");
  assert.equal(parseReclaimed("Total reclaimed space: 0B\nTotal:\t0B\n"), "0B");
});
