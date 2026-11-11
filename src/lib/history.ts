/**
 * Port history: every scan is compared with the one before, and a port that starts or stops listening
 * becomes an event. Replaying the events gives what listened at any moment, so the History tab can say
 * what ran this morning that doesn't run now. Pure; the file it lives in is src/server/history-store.ts.
 */
import type { PortRow, Protocol, Snapshot } from "@/lib/collect/types";
import { portReport } from "@/lib/report";

/** One port starting (`up`) or stopping, as seen by the scan at `at`. */
export type PortEvent = {
  at: string;
  up: boolean;
  /** port and owner: `3000/4121`, or `5432/<container id>` for a container (its pid is only Docker's proxy) */
  key: string;
  port: number;
  /** what listens, as the dashboard names it: `next dev`, a container, an ssh forward */
  what: string;
  project?: string;
  protocol?: Protocol;
  /** already listening when history began: it says what ran, not that it started then */
  first?: boolean;
};

export type Listener = Omit<PortEvent, "at" | "up" | "first">;

const keyOf = (r: PortRow) => `${r.port}/${r.containerId ?? r.pid}`;

/** What a scan shows as listening, by key; system services are left out, they only add noise. */
export function listeners(snap: Snapshot): Map<string, Listener> {
  const out = new Map<string, Listener>();
  for (const r of snap.ports) {
    if (r.system || out.has(keyOf(r))) continue;
    const report = portReport(snap, r);
    out.set(keyOf(r), { key: keyOf(r), port: r.port, what: report.owner, project: report.project, protocol: r.protocol });
  }
  return out;
}

/** The events between two scans: what stopped listening, then what started. */
export function diff(before: Map<string, Listener>, after: Map<string, Listener>, at: string): PortEvent[] {
  return [
    ...[...before.values()].filter((l) => !after.has(l.key)).map((l) => ({ ...l, at, up: false })),
    ...[...after.values()].filter((l) => !before.has(l.key)).map((l) => ({ ...l, at, up: true })),
  ];
}

/** What listened at `at`, replaying the events (oldest first) up to it. */
export function stateAt(events: PortEvent[], at: string): Map<string, Listener> {
  const state = new Map<string, Listener>();
  for (const e of events) {
    if (e.at > at) break;
    if (e.up) state.set(e.key, { key: e.key, port: e.port, what: e.what, project: e.project, protocol: e.protocol });
    else state.delete(e.key);
  }
  return state;
}

/**
 * Drop the events before `cutoff`, but keep what still listened then as `first` events at the cutoff:
 * a server running longer than history is kept must not look started later. Returns `events` itself
 * when nothing is older than the cutoff.
 */
export function trim(events: PortEvent[], cutoff: string): PortEvent[] {
  const from = events.findIndex((e) => e.at >= cutoff);
  const old = from === -1 ? events.length : from;
  if (old === 0) return events;
  const carried = [...stateAt(events.slice(0, old), cutoff).values()].map((l) => ({ ...l, at: cutoff, up: true, first: true }));
  return [...carried, ...events.slice(old)];
}

/** Then against now: what has stopped since (with when it stopped), and what started since. */
export function compare(events: PortEvent[], then: string, now: Map<string, Listener>) {
  const before = stateAt(events, then);
  const stoppedAt = (key: string) => events.findLast((e) => e.key === key && !e.up && e.at > then)?.at;
  return {
    gone: [...before.values()].filter((l) => !now.has(l.key)).map((l) => ({ ...l, stoppedAt: stoppedAt(l.key) })),
    started: [...now.values()].filter((l) => !before.has(l.key)),
  };
}
