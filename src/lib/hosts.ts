import { homedir } from "node:os";
import path from "node:path";
import { jsonFile } from "./json-file";

/** A VPS / remote machine probed over SSH (docker ps + listening ports). */
export type RemoteHost = { id: number; name: string; sshTarget: string; createdAt: string };

const store = jsonFile<RemoteHost[]>(process.env.TRIAGE_HOSTS_FILE ?? path.join(homedir(), ".config", "triage", "hosts.json"), []);

export async function listHosts(): Promise<RemoteHost[]> {
  return (await store.read()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolves false when the target is already stored. */
export function addHost(sshTarget: string, name: string) {
  return store.update((hosts) =>
    hosts.some((h) => h.sshTarget === sshTarget)
      ? null
      : [...hosts, { id: Math.max(0, ...hosts.map((h) => h.id)) + 1, name, sshTarget, createdAt: new Date().toISOString() }],
  );
}

export function removeHost(id: number) {
  return store.update((hosts) => hosts.filter((h) => h.id !== id));
}
