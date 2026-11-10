import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDockerStats } from "./docker";

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
