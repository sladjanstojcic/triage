import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import { protocolFromHint } from "@/lib/format";
import { classifyReply, probe, protocolFromPort } from "./protocol";

test("protocolFromHint: databases by tech, command or image; HTTP services with database names are not", () => {
  assert.equal(protocolFromHint("Postgres /opt/homebrew/opt/postgresql@17/bin/postgres -D x"), "postgres");
  assert.equal(protocolFromHint("public.ecr.aws/supabase/postgres:17.1 supabase_db_shop"), "postgres");
  assert.equal(protocolFromHint("redis:7-alpine cache"), "redis");
  assert.equal(protocolFromHint("mariadb:11"), "mysql");
  assert.equal(protocolFromHint("public.ecr.aws/supabase/postgrest:v12 supabase_rest_shop"), undefined);
  assert.equal(protocolFromHint("public.ecr.aws/supabase/postgres-meta:v0.84 supabase_pg_meta_shop"), undefined);
  assert.equal(protocolFromHint("Next.js next dev"), undefined);
});

test("classifyReply: HTTP answers and server banners", () => {
  assert.equal(classifyReply("HTTP/1.1 200 OK\r\n"), "http");
  assert.equal(classifyReply("SSH-2.0-OpenSSH_9.6\r\n"), "ssh");
  assert.equal(classifyReply("220 mailpit ESMTP\r\n"), "smtp");
  assert.equal(classifyReply("+OK Mailpit POP3 server\r\n"), "pop3");
  assert.equal(classifyReply("* OK [CAPABILITY IMAP4rev1] ready\r\n"), "imap");
  assert.equal(classifyReply(""), undefined);
});

/** Listen on a free loopback port and return it. */
async function listen(server: net.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}

test("probe: an HTTP server, a server with a banner, and one that says nothing", { timeout: 30_000 }, async () => {
  const web = http.createServer((_, res) => res.end("ok"));
  const sshd = net.createServer((s) => s.end("SSH-2.0-test\r\n"));
  // holds the connection open without a word, like a database waiting for its handshake
  const held: net.Socket[] = [];
  const quiet = net.createServer((s) => held.push(s));
  try {
    assert.equal(await probe(await listen(web), "127.0.0.1"), "http");
    assert.equal(await probe(await listen(sshd), "127.0.0.1"), "ssh");
    assert.equal(await probe(await listen(quiet), "127.0.0.1"), "tcp");
  } finally {
    held.forEach((s) => s.destroy());
    for (const s of [web, sshd, quiet]) s.close();
  }
});

test("protocolFromPort: well-known database ports only", () => {
  assert.equal(protocolFromPort(5432), "postgres");
  assert.equal(protocolFromPort(6379), "redis");
  assert.equal(protocolFromPort(3000), undefined);
  assert.equal(protocolFromPort(undefined), undefined);
});
