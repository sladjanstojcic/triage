import assert from "node:assert/strict";
import { test } from "node:test";
import { parseForward } from "./ssh";

const f = (kind: "L" | "R" | "D", spec: string) => parseForward({ kind, spec });

test("parseForward -L: command line and ~/.ssh/config forms come out the same", () => {
  const want = { localPort: 28080, bind: "127.0.0.1", destHost: "localhost", destPort: 18080 };
  assert.deepEqual(f("L", "127.0.0.1:28080:localhost:18080"), { kind: "L", spec: "127.0.0.1:28080:localhost:18080", ...want });
  assert.deepEqual(f("L", "127.0.0.1:28080 → localhost:18080"), { kind: "L", spec: "127.0.0.1:28080 → localhost:18080", ...want });
});

test("parseForward -L without bind address, to another machine", () => {
  assert.deepEqual(f("L", "5432:db.internal:5432"), {
    kind: "L", spec: "5432:db.internal:5432", localPort: 5432, bind: undefined, destHost: "db.internal", destPort: 5432,
  });
});

test("parseForward -R opens a port on the host that leads back here", () => {
  assert.deepEqual(f("R", "8080:localhost:3000"), {
    kind: "R", spec: "8080:localhost:3000", remotePort: 8080, bind: undefined, destHost: "localhost", destPort: 3000,
  });
});

test("parseForward -D is a SOCKS port", () => {
  assert.equal(f("D", "1080").localPort, 1080);
  assert.deepEqual(f("D", "127.0.0.1:1080"), { kind: "D", spec: "127.0.0.1:1080", localPort: 1080, bind: "127.0.0.1" });
});

test("parseForward: unix socket forwards keep only their spec", () => {
  assert.deepEqual(f("L", "/tmp/a.sock:/run/b.sock"), { kind: "L", spec: "/tmp/a.sock:/run/b.sock" });
});
