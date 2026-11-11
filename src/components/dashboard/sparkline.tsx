import { useState } from "react";
import type { UsageSample } from "@/lib/collect/types";
import { formatMem } from "@/lib/format";

const W = 64;
const H = 18;
const PAD = 2;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * A small line of recent values, from zero up to the highest one, with the value under the pointer.
 * One series in one hue; the number beside it carries the reading, the line only the shape.
 */
function Sparkline({
  values,
  times,
  format,
  label,
  floor = 0,
}: {
  values: number[];
  times: string[];
  format: (v: number) => string;
  label: string;
  /** the scale reaches at least this high, so noise near zero stays flat */
  floor?: number;
}) {
  const [hover, setHover] = useState<number>();
  const top = Math.max(...values);
  const max = Math.max(top, floor) || 1;
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const minutes = Math.round((Date.parse(times.at(-1)!) - Date.parse(times[0])) / 60_000);
  return (
    <span className="relative inline-flex">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`${label} over the last ${minutes} min: from ${format(Math.min(...values))} to ${format(top)}, now ${format(values.at(-1)!)}`}
        className="overflow-visible text-sky-600 dark:text-sky-400"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left - PAD) / (W - 2 * PAD)) * (values.length - 1));
          setHover(Math.max(0, Math.min(values.length - 1, i)));
        }}
        onPointerLeave={() => setHover(undefined)}
      >
        <polyline
          points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== undefined && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-border" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(values[hover])} r={2.5} fill="currentColor" className="stroke-background" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {hover !== undefined && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-popover-foreground shadow-sm">
          {clock(times[hover])} · {format(values[hover])}
        </span>
      )}
    </span>
  );
}

const percent = (v: number) => `${Math.round(v * 10) / 10}%`;

/** A running container's CPU and memory now, each with its last half hour as a line once there are two samples. */
export function ContainerUsage({ cpu, memMB, usage }: { cpu?: number; memMB?: number; usage?: UsageSample[] }) {
  if (cpu === undefined || memMB === undefined) return <span className="block text-right text-xs text-muted-foreground">-</span>;
  const lines = usage && usage.length >= 2;
  const times = usage?.map((s) => s.at) ?? [];
  return (
    <div className="flex flex-col items-end gap-0.5 text-xs tabular-nums">
      <span className="flex items-center gap-2">
        {/* an idle container wobbles around 0.1%: up to 5% (of one core) is drawn as flat */}
        {lines && <Sparkline values={usage.map((s) => s.cpu)} times={times} format={(v) => `${percent(v)} CPU`} label="CPU" floor={5} />}
        <span className="w-16 text-right">{percent(cpu)} CPU</span>
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        {lines && <Sparkline values={usage.map((s) => s.memMB)} times={times} format={formatMem} label="Memory" />}
        <span className="w-16 text-right">{formatMem(memMB)}</span>
      </span>
    </div>
  );
}
