// Where port history lives: ~/.config/triage/history.jsonl, one event per line, the last week kept.
// Every scan feeds record(); only scans that see a change write anything.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Snapshot } from "@/lib/collect/types";
import { diff, type Listener, listeners, type PortEvent, stateAt, trim } from "@/lib/history";

const FILE = process.env.TRIAGE_HISTORY_FILE ?? path.join(homedir(), ".config", "triage", "history.jsonl");
const KEEP_MS = 7 * 24 * 3600_000;

let events: PortEvent[] = [];
let loading: Promise<void> | undefined;
let current: Map<string, Listener> | undefined;
// no history yet: the first scan's ports were already running, not started then
let fresh = false;
// one write at a time, in order
let writing: Promise<unknown> = Promise.resolve();

const cutoff = () => new Date(Date.now() - KEEP_MS).toISOString();

/** Read the file once, even when two scans ask at the same time; trimmed to the last week (and rewritten when trimmed). */
function load() {
  loading ??= read();
  return loading;
}

async function read() {
  const lines = await readFile(FILE, "utf8").catch(() => "");
  const all = lines.split("\n").flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as PortEvent] : [];
    } catch {
      return [];
    }
  });
  // what was listening when Triage last looked, so a restart doesn't log every port as new
  current = stateAt(all, new Date().toISOString());
  fresh = all.length === 0;
  events = trim(all, cutoff());
  if (events !== all) {
    const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
    writing = writing.then(() => writeFile(FILE, text)).catch((e) => console.error("history:", e));
  }
}

/** Compare a fresh scan with the last one and keep what changed. Never throws: history is best effort. */
export async function record(snap: Snapshot) {
  // a scan that missed ports would log them as stopped and started again
  if (snap.partial) return;
  try {
    await load();
    const now = listeners(snap);
    const changes = diff(current ?? new Map(), now, snap.at).map((e) => (fresh ? { ...e, first: true } : e));
    current = now;
    fresh = false;
    if (changes.length === 0) return;
    // a long-running server drops what has aged out in memory; the file is trimmed on the next start
    events = trim([...events, ...changes], cutoff());
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
  await load();
  return events.filter((e) => e.at >= since);
}
