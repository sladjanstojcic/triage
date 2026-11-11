import { ScrollTextIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { containerLogs } from "@/lib/api";
import type { ContainerSummary, LogLine } from "@/lib/collect/types";
import { isUp } from "@/lib/grouping";
import type { RemoteHostRef } from "./stop";
import { usePolling } from "./use-polling";

// a remote host is read over ssh, so it is refreshed less often
const LOCAL_MS = 3000;
const REMOTE_MS = 10_000;

/** "12:28:34", with the date in front when it isn't today. */
function time(at?: string) {
  if (!at) return "";
  const d = new Date(at);
  const t = d.toLocaleTimeString([], { hour12: false });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
}

/** The drawer's body: mounted only while it is open, so a closed drawer never polls. */
function Logs({ container: c, host }: { container: ContainerSummary; host?: RemoteHostRef }) {
  const [lines, setLines] = useState<LogLine[]>();
  const [error, setError] = useState<string>();
  const box = useRef<HTMLPreElement>(null);
  // follow new lines only while the reader is at the bottom, so scrolling up to read isn't undone
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    const res = await containerLogs(c.id, host?.id);
    setError(res.error);
    if (res.lines) setLines(res.lines);
  }, [c.id, host?.id]);
  usePolling(load, host ? REMOTE_MS : LOCAL_MS, !isUp(c));

  useLayoutEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="font-mono break-all">{c.name}</SheetTitle>
        <SheetDescription>
          Last 300 lines of <code className="font-mono">docker logs</code>
          {host ? ` on ${host.name}` : ""}
          {isUp(c) ? `, refreshed every ${(host ? REMOTE_MS : LOCAL_MS) / 1000} s.` : ". The container is stopped."}
        </SheetDescription>
      </SheetHeader>
      {error && <p className="mx-4 text-xs text-destructive">{error}</p>}
      <pre
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="mx-4 mb-4 min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
      >
        {!lines ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : lines.length === 0 ? (
          <span className="text-muted-foreground">No output yet.</span>
        ) : (
          lines.map((l, i) => (
            // wrapped lines stay right of the time column
            <div key={i} className="flex gap-3">
              <span className="shrink-0 text-muted-foreground select-none">{time(l.at)}</span>
              <span className="min-w-0">{l.text}</span>
            </div>
          ))
        )}
      </pre>
    </>
  );
}

/** Opens a container's recent log in a side drawer, on this Mac or a remote host. */
export function LogsButton({ container, host }: { container: ContainerSummary; host?: RemoteHostRef }) {
  const [open, setOpen] = useState(false);
  const title = `Logs of ${container.name}${host ? ` on ${host.name}` : ""}`;
  return (
    <>
      <Button variant="ghost" size="icon-sm" title={title} aria-label={title} onClick={() => setOpen(true)}>
        <ScrollTextIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
          {open && <Logs container={container} host={host} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
