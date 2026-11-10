import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedSeconds, formatBytes, formatMem, humanElapsed, shortCommand, shortUptime, since } from "./format";

const cases: [string, string][] = [
  // node + CLI from node_modules/.bin, including a folder with a space in it
  ["node ~/code/app/node_modules/.bin/next dev -H 127.0.0.1 -p 4545", "next dev -H 127.0.0.1 -p 4545"],
  ["node ~/Desktop/MY DB/next/apps/web/node_modules/.bin/../next/dist/bin/next dev -p 4099", "next dev -p 4099"],
  // node loader flags dropped, a plain script keeps its interpreter
  [
    "~/.volta/tools/image/node/24.19.0/bin/node --require ~/app/node_modules/tsx/dist/preflight.cjs --import file:///~/app/node_modules/tsx/dist/loader.mjs src/server/index.ts",
    "node src/server/index.ts",
  ],
  ["python3 manage.py runserver", "python3 manage.py runserver"],
  ["python3 -m http.server 18080 --bind 127.0.0.1", "python3 -m http.server 18080 --bind 127.0.0.1"],
  ["node -e 'require(1)'", "node -e 'require(1)'"],
  // interpreter in front of an installed CLI
  ["~/.local/share/uv/tools/serena/bin/python ~/.local/bin/serena start-mcp-server", "serena start-mcp-server"],
  // package script without a bin
  ["/usr/bin/node ~/.npm/_npx/6ddf/node_modules/@browsermcp/mcp/dist/daemon.js", "@browsermcp/mcp/dist/daemon.js"],
  // bin folders, arch subfolders, libexec, macOS app bundles; flag values keep their paths
  [
    "~/Library/Application Support/Local/mysql-8.4.0/bin/darwin-arm64/bin/mysqld --defaults-file=~/Library/my.cnf",
    "mysqld --defaults-file=~/Library/my.cnf",
  ],
  ["~/Library/Application Support/Local/mailpit-1.24/bin/darwin-arm64/mailpit", "mailpit"],
  ["/usr/libexec/rapportd", "rapportd"],
  ["/Applications/Zed.app/Contents/MacOS/zed", "zed"],
  ["/Applications/Tailscale.app/Contents/PlugIns/IPNExtension.appex/Contents/MacOS/IPNExtension -x", "IPNExtension -x"],
  ["sshd: /usr/sbin/sshd -D [listener]", "sshd: sshd -D [listener]"],
  // already short: unchanged
  ["codex --yolo resume", "codex --yolo resume"],
];

for (const [input, expected] of cases) {
  test(`shortCommand: ${expected}`, () => assert.equal(shortCommand(input), expected));
}

const uptimes: [string, string][] = [
  ["10:10:55 up 4 days, 44 min,  4 users,  load average: 0.51, 0.39, 0.38", "up 4d 44m · load 0.51"],
  ["10:10:55 up 1 day,  3:07,  1 user,  load average: 1.20, 0.80, 0.50", "up 1d 3h 7m · load 1.20"],
  ["10:10:55 up 12 min,  2 users,  load average: 0.00, 0.01, 0.05", "up 12m · load 0.00"],
  ["10:10:55 up  3:12,  0 users,  load average: 0.10, 0.10, 0.10", "up 3h 12m · load 0.10"],
  ["not uptime output", "not uptime output"],
];
for (const [input, expected] of uptimes) {
  test(`shortUptime: ${expected}`, () => assert.equal(shortUptime(input), expected));
}

test("formatBytes: decimal for disks, binary for memory", () => {
  assert.equal(formatBytes(494.4e9), "494 GB");
  assert.equal(formatBytes(20.7e9), "20.7 GB");
  assert.equal(formatBytes(17179869184, true), "16.0 GB");
  assert.equal(formatBytes(512), "512 B");
});

test("since: days+hours, hours+minutes, minutes", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  assert.equal(since("2026-11-06T09:59:00Z", now), "1d 2h");
  assert.equal(since("2026-11-07T08:55:00Z", now), "3h 5m");
  assert.equal(since("2026-11-07T11:48:00Z", now), "12m");
});

test("tabFromPath: known tab, root and unknown paths", async () => {
  const { tabFromPath } = await import("./tabs");
  assert.equal(tabFromPath("/ssh"), "ssh");
  assert.equal(tabFromPath("/remote/"), "remote");
  assert.equal(tabFromPath("/"), "overview");
  assert.equal(tabFromPath("/nope"), "overview");
});

test("elapsedSeconds and humanElapsed read the same ps etime forms", () => {
  assert.equal(elapsedSeconds("05:07"), 307);
  assert.equal(elapsedSeconds("02:05:07"), 2 * 3600 + 307);
  assert.equal(elapsedSeconds("3-02:05:07"), 3 * 86400 + 2 * 3600 + 307);
  assert.equal(elapsedSeconds(""), undefined);
  assert.equal(humanElapsed("3-02:05:07"), "3d 2h");
});

test("formatMem: MiB from ps and docker stats", () => {
  assert.equal(formatMem(850), "850 MB");
  assert.equal(formatMem(1536), "1.5 GB");
});
