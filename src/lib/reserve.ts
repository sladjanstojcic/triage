/**
 * Port reservations: a coding agent asks Triage for a free port and gets one no other agent is handed
 * until the reservation runs out, even before its server listens. They are kept with the port's other
 * settings (`PortPref.reserved`); picking and saving happen in one serialized write (src/server/actions.ts).
 */
import type { PortPref } from "@/lib/collect/types";

export const RESERVE_MINUTES = 60;
export const RESERVE_MAX_MINUTES = 24 * 60;
export const RESERVE_FOR_MAX = 80;
// where a dev server usually lives; preferred ports are tried first
const RANGE: [number, number] = [3000, 9999];

/** A reservation still in force at `now` (ISO). */
export const isReserved = (pref: PortPref | undefined, now: string) => !!pref?.reserved && pref.reserved.until > now;

/** The ports to try, in order: the preferred one, then the dev range upward from it (or from the bottom). */
export function* candidates(preferred?: number): Generator<number> {
  const [lo, hi] = RANGE;
  if (preferred) yield preferred;
  const start = preferred && preferred >= lo && preferred < hi ? preferred + 1 : lo;
  for (let p = start; p <= hi; p++) yield p;
  for (let p = lo; p < start; p++) if (p !== preferred) yield p;
}

/** The settings with every expired reservation dropped (and a port left with nothing set removed). */
export function dropExpired(prefs: Record<string, PortPref>, now: string): Record<string, PortPref> {
  const out: Record<string, PortPref> = {};
  for (const [port, pref] of Object.entries(prefs)) {
    const { reserved, ...rest } = pref;
    const next = reserved && reserved.until > now ? pref : rest;
    if (Object.keys(next).length) out[port] = next;
  }
  return out;
}
