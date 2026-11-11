import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBattery, parseDf, parseDockerDf, parseSize, parseSwapUsage, parseVmStat, parseVpnList } from "./machine";

test("parseVmStat: active + wired + compressed pages", () => {
  const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3781.
Pages active:                            138012.
Pages inactive:                          136919.
Pages wired down:                        386890.
Pages occupied by compressor:            341549.`;
  assert.deepEqual(parseVmStat(out, 17179869184), { used: (138012 + 386890 + 341549) * 16384, total: 17179869184 });
});

test("parseSwapUsage", () => {
  assert.deepEqual(parseSwapUsage("total = 22528.00M  used = 21453.62M  free = 1074.38M  (encrypted)"), {
    used: 21453.62 * 1024 * 1024,
    total: 22528 * 1024 * 1024,
  });
  assert.equal(parseSwapUsage("total = 0.00M  used = 0.00M  free = 0.00M"), undefined);
});

test("parseDf: container size minus available (APFS volumes share space)", () => {
  const out = `Filesystem     1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s5     482797652 416667016  20676836    96%    /System/Volumes/Data`;
  assert.deepEqual(parseDf(out, "/System/Volumes/Data"), {
    used: (482797652 - 20676836) * 1024,
    total: 482797652 * 1024,
    mount: "/System/Volumes/Data",
  });
});

test("parseBattery: laptop on battery, charging, desktop", () => {
  assert.deepEqual(parseBattery(" -InternalBattery-0 (id=21692515)\t47%; discharging; 2:37 remaining present: true"), {
    percent: 47,
    charging: false,
    remaining: "2:37",
  });
  assert.equal(parseBattery(" -InternalBattery-0 (id=1)\t80%; charging; (no estimate) present: true")?.charging, true);
  assert.equal(parseBattery("Now drawing from 'AC Power'"), undefined);
});

test("parseSize and parseDockerDf", () => {
  assert.equal(parseSize("34.55GB"), 34.55e9);
  assert.equal(parseSize("0B"), 0);
  assert.equal(parseSize("45.5MiB"), 45.5 * 1024 ** 2);
  assert.equal(parseSize("2.91GiB"), 2.91 * 1024 ** 3);
  assert.deepEqual(
    parseDockerDf(`{"Active":"24","Reclaimable":"17.93GB (51%)","Size":"34.55GB","TotalCount":"48","Type":"Images"}
{"Active":"0","Reclaimable":"0B","Size":"0B","TotalCount":"0","Type":"Build Cache"}`),
    [
      { type: "Images", count: 48, active: 24, size: 34.55e9, reclaimable: 17.93e9 },
      { type: "Build Cache", count: 0, active: 0, size: 0, reclaimable: 0 },
    ],
  );
});

test("parseVpnList: only connected services, by the name macOS shows", () => {
  const out = `Available network connection services in the current set (*=enabled):
* (Connected)      BB01C51F-377D-4374-B276-7962D1F1E7F7 VPN (io.tailscale.ipn.macos) "Tailscale"                      [VPN:io.tailscale.ipn.macos]
* (Disconnected)   13A951A8-11B4-4D0C-84EA-D15EE6C8ED51 VPN (ch.protonvpn.mac) "ProtonVPN"                      [VPN:ch.protonvpn.mac]
* (Connected)      0E2B0C64-0000-0000-0000-000000000000 VPN (com.wireguard.macos) "Work VPN"  [VPN:com.wireguard.macos]`;
  assert.deepEqual(parseVpnList(out), ["Tailscale", "Work VPN"]);
  assert.deepEqual(parseVpnList(""), []);
});
