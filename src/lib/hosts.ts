import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** A VPS / remote machine probed over SSH (docker ps + listening ports). */
export type RemoteHost = { id: number; name: string; sshTarget: string; createdAt: string };

const FILE = process.env.TRIAGE_HOSTS_FILE ?? path.join(homedir(), ".config", "triage", "hosts.json");

export async function listHosts(): Promise<RemoteHost[]> {
  try {
    const hosts = JSON.parse(await readFile(FILE, "utf8")) as RemoteHost[];
    return hosts.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

// Writes are serialized so two quick adds can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function update(fn: (hosts: RemoteHost[]) => RemoteHost[] | null) {
  const next = queue.then(async () => {
    const hosts = fn(await listHosts());
    if (!hosts) return false;
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(hosts, null, 2) + "\n");
    await rename(tmp, FILE);
    return true;
  });
  queue = next.catch(() => {});
  return next;
}

/** Resolves false when the target is already stored. */
export function addHost(sshTarget: string, name: string) {
  return update((hosts) =>
    hosts.some((h) => h.sshTarget === sshTarget)
      ? null
      : [...hosts, { id: Math.max(0, ...hosts.map((h) => h.id)) + 1, name, sshTarget, createdAt: new Date().toISOString() }],
  );
}

export function removeHost(id: number) {
  return update((hosts) => hosts.filter((h) => h.id !== id));
}
