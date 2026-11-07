/** This Mac's identity and load (sysctl, vm_stat, df, pmset), and `docker system df`. */
import os from "node:os";
import { run } from "@/lib/exec";
import type { DockerDiskRow, MachineInfo, Usage } from "./types";

/** vm_stat → memory in use the way Activity Monitor counts it: app (active) + wired + compressed. */
export function parseVmStat(text: string, total: number): Usage | undefined {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (label: string) => Number(text.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? NaN);
  const used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;
  return Number.isFinite(used) ? { used: Math.min(used, total), total } : undefined;
}

const MB = 1024 * 1024;

/** "total = 22528.00M  used = 21453.62M  free = 1074.38M  (encrypted)" */
export function parseSwapUsage(text: string): Usage | undefined {
  const total = Number(text.match(/total = ([\d.]+)M/)?.[1]);
  const used = Number(text.match(/used = ([\d.]+)M/)?.[1]);
  return Number.isFinite(total) && Number.isFinite(used) && total > 0 ? { used: used * MB, total: total * MB } : undefined;
}

/** Last line of `df -kP <mount>` → used/total bytes. */
export function parseDf(text: string, mount: string): (Usage & { mount: string }) | undefined {
  const cols = text.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
  const [size, avail] = [Number(cols[1]), Number(cols[3])];
  // size minus available, not this volume's own "used": APFS volumes share one container, and Finder
  // counts the system, Data and VM volumes together
  return Number.isFinite(size) && Number.isFinite(avail) && size > 0 ? { used: (size - avail) * 1024, total: size * 1024, mount } : undefined;
}

/** `pmset -g batt` → "47%; discharging; 2:37 remaining"; undefined on a desktop. */
export function parseBattery(text: string): MachineInfo["battery"] {
  const m = text.match(/(\d+)%;\s*([^;]+);\s*([^\s]+)?/);
  if (!m) return undefined;
  const state = m[2].trim();
  const remaining = m[3] && /^\d+:\d+$/.test(m[3]) ? m[3] : undefined;
  return { percent: Number(m[1]), charging: state === "charging" || state === "charged" || state === "finishing charge", remaining };
}

/** "34.55GB", "6.361MB", "0B" → bytes (docker uses powers of 1000). */
export function parseSize(text: string): number {
  const m = text.trim().match(/^([\d.]+)\s*([kKMGT]?B)$/);
  if (!m) return 0;
  const unit = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2]] ?? 1;
  return Number(m[1]) * unit;
}

/** `docker system df --format '{{json .}}'` lines → rows. */
export function parseDockerDf(text: string): DockerDiskRow[] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, string>)
    .map((r) => ({
      type: r.Type,
      count: Number(r.TotalCount) || 0,
      active: Number(r.Active) || 0,
      size: parseSize(r.Size ?? "0B"),
      reclaimable: parseSize((r.Reclaimable ?? "0B").split(" ")[0]),
    }));
}

/** Everything here takes ~40 ms, so it runs on every scan. */
export async function collectMachine(): Promise<MachineInfo> {
  const [sys, vm, swap, ver, df, batt] = await Promise.all([
    run("sysctl", ["-n", "machdep.cpu.brand_string", "hw.ncpu", "hw.memsize", "kern.boottime"]),
    run("vm_stat", []),
    run("sysctl", ["-n", "vm.swapusage"]),
    run("sw_vers", ["-productVersion"]),
    // user data lives on the Data volume; "/" is the small sealed system volume
    run("df", ["-kP", "/System/Volumes/Data"]),
    run("pmset", ["-g", "batt"]),
  ]);
  const [cpu, cores, memsize, boot] = sys.stdout.split("\n");
  const total = Number(memsize) || os.totalmem();
  const bootSec = Number(boot?.match(/sec = (\d+)/)?.[1]);
  const load = os.loadavg();
  return {
    hostname: os.hostname().replace(/\.local$/, ""),
    os: ver.ok ? `macOS ${ver.stdout.trim()}` : undefined,
    cpu: cpu?.trim() || undefined,
    cores: Number(cores) || os.cpus().length,
    bootedAt: bootSec ? new Date(bootSec * 1000).toISOString() : undefined,
    load: [load[0], load[1], load[2]],
    memory: parseVmStat(vm.stdout, total),
    swap: parseSwapUsage(swap.stdout),
    disk: df.ok ? parseDf(df.stdout, "/System/Volumes/Data") : undefined,
    battery: batt.ok ? parseBattery(batt.stdout) : undefined,
  };
}

// `docker system df` takes about a second, so it refreshes in the background every couple of minutes and
// scans return the last result.
const DOCKER_DF_MS = 2 * 60_000;
let dockerDisk: { at: number; rows?: DockerDiskRow[]; pending?: Promise<void> } = { at: 0 };

export function cachedDockerDisk(): DockerDiskRow[] | undefined {
  if (Date.now() - dockerDisk.at > DOCKER_DF_MS && !dockerDisk.pending) {
    dockerDisk.pending = run("docker", ["system", "df", "--format", "{{json .}}"], 15_000).then((res) => {
      dockerDisk = { at: Date.now(), rows: res.ok ? parseDockerDf(res.stdout) : undefined };
    });
  }
  return dockerDisk.rows;
}
