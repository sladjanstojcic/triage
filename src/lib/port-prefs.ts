// What you set on a port number: pin it to the top, hide it, watch it, or leave a note. Kept by port number, so it
// still applies after the server behind it restarts.
import { homedir } from "node:os";
import path from "node:path";
import type { PortPref } from "@/lib/collect/types";
import { jsonFile } from "./json-file";
import { candidates, dropExpired, isReserved } from "./reserve";

const store = jsonFile<Record<string, PortPref>>(
  process.env.TRIAGE_PORTS_FILE ?? path.join(homedir(), ".config", "triage", "ports.json"),
  {},
);

export const NOTE_MAX = 200;

export const readPortPrefs = store.read;

/** Merge a change into one port's settings; a port left with nothing set is removed from the file. */
/**
 * Reserve the first port that nothing listens on (`taken`), nothing else holds reserved, and `canBind`
 * confirms is free, in the same write that saves it: two agents asking at once get different ports.
 */
export async function reservePort(
  reservation: { for: string; until: string },
  taken: Set<number>,
  canBind: (port: number) => Promise<boolean>,
  preferred?: number,
): Promise<number | undefined> {
  let port: number | undefined;
  await store.update(async (stored) => {
    const now = new Date().toISOString();
    const prefs = dropExpired(stored, now);
    for (const p of candidates(preferred)) {
      if (taken.has(p) || isReserved(prefs[p], now) || !(await canBind(p))) continue;
      port = p;
      return { ...prefs, [p]: { ...prefs[p], reserved: reservation } };
    }
    return null;
  });
  return port;
}

export function setPortPref(port: number, change: PortPref) {
  return store.update((prefs) => {
    const next: PortPref = { ...prefs[port], ...change };
    if (!next.pinned) delete next.pinned;
    if (!next.hidden) delete next.hidden;
    if (!next.watched) delete next.watched;
    if (!next.note?.trim()) delete next.note;
    if (!next.reserved) delete next.reserved;
    const rest = { ...prefs };
    delete rest[port];
    return Object.keys(next).length ? { ...rest, [port]: next } : rest;
  });
}
