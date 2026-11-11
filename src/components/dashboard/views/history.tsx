import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Snapshot } from "@/lib/collect/types";
import { matches } from "@/lib/format";
import { compare, type Listener, listeners, type PortEvent } from "@/lib/history";
import { cn } from "@/lib/utils";
import { ProtocolTag } from "../cells";
import { usePolling } from "../use-polling";

const POLL_MS = 30_000;
const TIMELINE_SHOWN = 200;

/** Moments to compare with: an hour ago, 9:00 this morning, and this time yesterday. */
function moments(now = new Date()) {
  const morning = new Date(now);
  morning.setHours(9, 0, 0, 0);
  return [
    { label: "1 hour ago", at: new Date(now.getTime() - 3600_000) },
    ...(morning < now ? [{ label: "This morning, 9:00", at: morning }] : []),
    { label: "Yesterday, this time", at: new Date(now.getTime() - 24 * 3600_000) },
  ];
}

const clock = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
};

function Row({ l, children }: { l: Listener; children?: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-sm">
      <span className="w-16 shrink-0 font-mono font-semibold tabular-nums">:{l.port}</span>
      <span className="w-12 shrink-0">
        <ProtocolTag protocol={l.protocol} />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={l.what}>
        {l.what}
      </span>
      {l.project && <span className="shrink-0 text-xs text-muted-foreground">{l.project}</span>}
      {children}
    </li>
  );
}

/** What listened when: then against now, and every start and stop of the last day. */
export function HistoryView({ snap, query }: { snap: Snapshot; query: string }) {
  const [events, setEvents] = useState<PortEvent[]>();
  // when the events were fetched: "the last 24 hours" counts back from there, not from each render
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string>();
  // counted from the last load (every 30 s), so "1 hour ago" moves on while the tab stays open
  const options = useMemo(() => moments(new Date(loadedAt)), [loadedAt]);
  const [thenLabel, setThen] = useState(options[0].label);
  const then = options.find((o) => o.label === thenLabel) ?? options[0];

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEvents(await res.json());
      setLoadedAt(Date.now());
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  usePolling(load, POLL_MS, false);

  const now = useMemo(() => listeners(snap), [snap]);
  if (error) return <p className="py-10 text-center text-sm text-destructive">Couldn't load history: {error}</p>;
  if (!events) return <p className="py-10 text-center text-sm text-muted-foreground">Loading history…</p>;

  const hit = (x: unknown) => matches(x, query);
  const { gone, started } = compare(events, then.at.toISOString(), now);
  const dayAgo = new Date(loadedAt - 24 * 3600_000).toISOString();
  const timeline = events.filter((e) => !e.first && e.at >= dayAgo && hit(e)).reverse().slice(0, TIMELINE_SHOWN);
  // before its first event history knows nothing, so those moments can't be compared
  const since = events[0]?.at;
  const known = (at: Date) => !!since && at.toISOString() >= since;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">Compared with</CardTitle>
          {options.map((o) => (
            <Button
              key={o.label}
              size="sm"
              variant={o.label === then.label ? "secondary" : "ghost"}
              disabled={!known(o.at)}
              title={known(o.at) ? undefined : `History starts ${since ? clock(since) : "with the next scan"}`}
              onClick={() => setThen(o.label)}
            >
              {o.label}
            </Button>
          ))}
        </CardHeader>
        {!known(then.at) ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Triage started keeping history {since ? `at ${clock(since)}` : "just now"}; it can compare with any moment after that.
            </p>
          </CardContent>
        ) : (
          <CardContent className="grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Ran then, not now</h3>
              {gone.filter(hit).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing.</p>
              ) : (
                <ul className="divide-y">
                  {gone.filter(hit).map((l) => (
                    <Row key={l.key} l={l}>
                      {l.stoppedAt && <span className="shrink-0 font-mono text-xs text-muted-foreground">stopped {clock(l.stoppedAt)}</span>}
                    </Row>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">New since then</h3>
              {started.filter(hit).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing.</p>
              ) : (
                <ul className="divide-y">
                  {started.filter(hit).map((l) => (
                    <Row key={l.key} l={l} />
                  ))}
                </ul>
              )}
            </section>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last 24 hours</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No port started or stopped in the last day.</p>
          ) : (
            <ul className="divide-y">
              {timeline.map((e) => (
                <Row key={`${e.at}-${e.key}-${e.up}`} l={e}>
                  <span className={cn("flex shrink-0 items-center gap-1 font-mono text-xs", e.up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {e.up ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />}
                    {e.up ? "started" : "stopped"} {clock(e.at)}
                  </span>
                </Row>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
