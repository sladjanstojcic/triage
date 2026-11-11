// What you set on a port number: pin it to the top, hide it, or leave a note. Kept by port number, so it
// still applies after the server behind it restarts.
import { homedir } from "node:os";
import path from "node:path";
import type { PortPref } from "@/lib/collect/types";
import { jsonFile } from "./json-file";

const store = jsonFile<Record<string, PortPref>>(
  process.env.TRIAGE_PORTS_FILE ?? path.join(homedir(), ".config", "triage", "ports.json"),
  {},
);

export const NOTE_MAX = 200;

export const readPortPrefs = store.read;

/** Merge a change into one port's settings; a port left with nothing set is removed from the file. */
export function setPortPref(port: number, change: PortPref) {
  return store.update((prefs) => {
    const next: PortPref = { ...prefs[port], ...change };
    if (!next.pinned) delete next.pinned;
    if (!next.hidden) delete next.hidden;
    if (!next.note?.trim()) delete next.note;
    const rest = { ...prefs };
    delete rest[port];
    return Object.keys(next).length ? { ...rest, [port]: next } : rest;
  });
}
