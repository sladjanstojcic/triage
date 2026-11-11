import assert from "node:assert/strict";
import { test } from "node:test";
import { candidates, dropExpired, isReserved } from "./reserve";

const first = (n: number, preferred?: number) => {
  const out: number[] = [];
  for (const p of candidates(preferred)) {
    out.push(p);
    if (out.length === n) break;
  }
  return out;
};

test("candidates: the preferred port, then upward from it; without one, from 3000", () => {
  assert.deepEqual(first(3), [3000, 3001, 3002]);
  assert.deepEqual(first(3, 5173), [5173, 5174, 5175]);
  // wraps to the bottom of the range after 9999, and never repeats the preferred port
  const all = [...candidates(9998)];
  assert.deepEqual(all.slice(0, 3), [9998, 9999, 3000]);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 7000);
  // a preferred port outside the range is tried, then the range from the bottom
  assert.deepEqual(first(2, 80), [80, 3000]);
});

test("reservations expire; expired ones are dropped with nothing else lost", () => {
  const prefs = {
    "3000": { reserved: { for: "a", until: "10:00" } },
    "3001": { pinned: true, reserved: { for: "b", until: "08:00" } },
    "3002": { reserved: { for: "c", until: "08:00" } },
  };
  assert.equal(isReserved(prefs["3000"], "09:00"), true);
  assert.equal(isReserved(prefs["3001"], "09:00"), false);
  assert.deepEqual(dropExpired(prefs, "09:00"), { "3000": prefs["3000"], "3001": { pinned: true } });
});
