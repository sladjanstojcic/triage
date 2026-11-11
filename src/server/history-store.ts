// Where port history lives: ~/.config/triage/history.jsonl, one event per line, the last week kept.
// Every scan feeds record(); only scans that see a change write anything.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Snapshot } from "@/lib/collect/types";
import { diff, type Listener, listeners, type PortEvent, stateAt } from "@/lib/history";

const FILE = process.env.TRIAGE_HISTORY_FILE ?? path.join(homedir(), ".config", "triage", "history.jsonl");
const KEEP_MS = 7 * 24 * 3600_000;

let events: PortEvent[] | undefined;
let current: Map<string, Listener> | undefined;
// no history yet: the first scan's ports were already running, not started then
let fresh = false;
// one write at a time, in order
let writing: Promise<unknown> = Promise.resolve();

/** The kept events, oldest first; read once, trimmed to the last week (and the file rewritten when trimmed). */
async function load(): Promise<PortEvent[]> {
  if (events) return events;
  const lines = await readFile(FILE, "utf8").catch(() => "");
  const all = lines.split("\n").flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as PortEvent] : [];
    } catch {
      return [];
    }
  });
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
  // what was listening when Triage last looked, so a restart doesn't log every port as new
  current = stateAt(all, new Date().toISOString());
  fresh = all.length === 0;
  events = all.filter((e) => e.at >= cutoff);
  if (events.length < all.length) {
    writing = writing.then(() => writeFile(FILE, events!.map((e) => `${JSON.stringify(e)}\n`).join("")));
  }
  return events;
}

/** Compare a fresh scan with the last one and keep what changed. Never throws: history is best effort. */
export async function record(snap: Snapshot) {
  try {
    const kept = await load();
    const now = listeners(snap);
    const changes = diff(current ?? new Map(), now, snap.at).map((e) => (fresh ? { ...e, first: true } : e));
    current = now;
    fresh = false;
    if (changes.length === 0) return;
    kept.push(...changes);
    // a long-running server drops what has aged out, as a fresh start would
    const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
    while (kept.length && kept[0].at < cutoff) kept.shift();
    writing = writing
      .then(() => mkdir(path.dirname(FILE), { recursive: true }))
      .then(() => appendFile(FILE, changes.map((e) => `${JSON.stringify(e)}\n`).join("")))
      .catch((e) => console.error("history:", e));
  } catch (e) {
    console.error("history:", e);
  }
}

/** Events since `since` (ISO), oldest first. */
export async function history(since: string): Promise<PortEvent[]> {
  return (await load()).filter((e) => e.at >= since);
}
