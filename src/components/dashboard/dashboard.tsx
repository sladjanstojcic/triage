import { ActivityIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, PauseIcon, PlayIcon, PlusIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { matches } from "@/lib/format";
import { TABS, type Tab, tabFromPath, tabLabel } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { containerGroups, findConflicts, groupByProject, isUp, projectCount, sshMachines, visiblePorts } from "@/lib/grouping";
import { AddHostSheet } from "./add-host-sheet";
import { CollapseContext, groupKey } from "./grouped-table";
import { RefreshContext, ScanContext } from "./stop";
import { ThemeMenu } from "./theme-menu";
import { usePolling } from "./use-polling";
import { DockerView } from "./views/docker";
import { NetworkView } from "./views/network";
import { OverviewView } from "./views/overview";
import { PortsView } from "./views/ports";
import { ProjectsView } from "./views/projects";
import { RemoteView } from "./views/remote";

const POLL_MS = 3000;
const REMOTE_POLL_MS = 30_000;

/** Keep only the parts of the snapshot whose text matches the search. */
function filterSnapshot(snap: Snapshot, q: string): Snapshot {
  if (!q.trim()) return snap;
  const hit = (v: unknown) => matches(v, q);
  return {
    ...snap,
    ports: snap.ports.filter(hit),
    containers: snap.containers.filter(hit),
    ssh: snap.ssh.filter(hit),
    tunnels: snap.tunnels.filter(hit),
  };
}

/** A header count; `label` is singular and gets an "s" unless `plural` says otherwise. */
function Stat({ label, plural = `${label}s`, value, warn }: { label: string; plural?: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("font-mono text-lg font-semibold tabular-nums", warn && "text-destructive")}>{value}</span>
      <span className="text-xs text-muted-foreground">{value === 1 ? label : plural}</span>
    </div>
  );
}

export function Dashboard() {
  const [snap, setSnap] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => tabFromPath(window.location.pathname));
  // each tab has its own path, so a reload stays on it and back/forward move between tabs
  const setTab = useCallback((next: Tab) => {
    if (next !== tabFromPath(window.location.pathname)) window.history.pushState(null, "", `/${next}`);
    setTabState(next);
  }, []);
  useEffect(() => {
    const onPop = () => setTabState(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title = `${tabLabel(tab)} · Triage`;
  }, [tab]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [remote, setRemote] = useState<RemoteSnapshot[]>();
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [addHostOpen, setAddHostOpen] = useState(false);

  const loadRemote = useCallback(async () => {
    setRemoteLoading(true);
    try {
      const res = await fetch("/api/remote");
      if (res.ok) setRemote(await res.json());
    } finally {
      setRemoteLoading(false);
    }
  }, []);

  // remote hosts are probed over ssh, so poll them far less often than the local machine
  usePolling(loadRemote, REMOTE_POLL_MS, paused);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/snapshot");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnap(await res.json());
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, POLL_MS, paused);

  const view = useMemo(() => (snap ? filterSnapshot(snap, query) : undefined), [snap, query]);
  const conflicts = useMemo(() => findConflicts(snap?.ports ?? []), [snap]);
  // the unfiltered scans: what a stop takes down doesn't depend on the search box
  const scan = useMemo(() => ({ snap, remote }), [snap, remote]);
  // group keys of the table on the active tab, for expand/collapse all
  const groupKeys = useMemo(() => {
    if (!view) return [];
    const keys =
      tab === "projects" ? groupByProject(view, showSystem).map((g) => g.key)
      : tab === "docker" ? containerGroups(view.containers).map(([g]) => g)
      : tab === "ssh" ? sshMachines(view.ssh, remote).map((m) => m.key)
      : tab === "remote" ? (remote ?? []).map((h) => String(h.id))
      : [];
    return keys.map((k) => groupKey(tab, k));
  }, [view, showSystem, tab, remote]);
  const collapse = useMemo(
    () => ({
      collapsed,
      toggle: (key: string) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
    }),
    [collapsed],
  );
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((k) => collapsed.has(k));

  return (
    <RefreshContext value={load}>
    <ScanContext value={scan}>
    <CollapseContext value={collapse}>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 desktop:max-w-none desktop:pt-0">
        {/* In the desktop app this is the title bar: it stays on top, drags the window and leaves room for the window buttons. */}
        <header className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 desktop:app-drag desktop:sticky desktop:top-0 desktop:z-20 desktop:-mx-4 desktop:min-h-13 desktop:border-b desktop:bg-background/85 desktop:py-2 desktop:pr-4 desktop:pl-21 desktop:backdrop-blur-md sm:desktop:-mx-6 sm:desktop:pr-6">
          <div className="flex items-center gap-2">
            <ActivityIcon className="size-5 text-emerald-500" />
            <h1 className="text-lg font-semibold tracking-tight">Triage</h1>
          </div>
          {snap && (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Stat label="port" value={visiblePorts(snap, showSystem).length} />
              <Stat label="project" value={projectCount(snap)} />
              <Stat label="container" value={snap.containers.filter(isUp).length} />
              <Stat label="ssh" plural="ssh" value={snap.ssh.length} />
              <Stat label="tunnel" value={snap.tunnels.length} />
              {conflicts.size > 0 && <Stat label="shared port" value={conflicts.size} warn />}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 desktop:app-no-drag">
            {snap && (
              <span className="mr-1 font-mono text-[11px] text-muted-foreground">
                {paused ? "paused · " : ""}updated {new Date(snap.at).toLocaleTimeString()}
              </span>
            )}
            <Button variant={showSystem ? "secondary" : "ghost"} size="sm" onClick={() => setShowSystem((s) => !s)}>
              {showSystem ? "Hide" : "Show"} system
            </Button>
            <Button variant="ghost" size="icon-sm" title={paused ? "Resume auto-refresh" : "Pause auto-refresh"} onClick={() => setPaused((p) => !p)}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Refresh now: rescan this Mac and re-probe the remote hosts"
              onClick={() => {
                load();
                loadRemote();
              }}
            >
              <RefreshCwIcon className={cn((loading || remoteLoading) && "animate-spin")} />
            </Button>
            <ThemeMenu />
          </div>
        </header>

        {(error || (snap?.errors.length ?? 0) > 0) && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div>{[error && `Snapshot failed: ${error}`, ...(snap?.errors ?? [])].filter(Boolean).join(" · ")}</div>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="ml-auto flex items-center gap-3">
              {tab === "remote" && (
                <Button size="sm" onClick={() => setAddHostOpen(true)}>
                  <PlusIcon data-icon="inline-start" /> Add host
                </Button>
              )}
              {groupKeys.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      for (const k of groupKeys) {
                        if (allCollapsed) next.delete(k);
                        else next.add(k);
                      }
                      return next;
                    })
                  }
                >
                  {allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </Button>
              )}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter: port, folder, branch…"
                  className="h-8 w-56 pl-8"
                />
              </div>
            </div>
          </div>

          {!view ? (
            <div className="py-20 text-center text-sm text-muted-foreground">Scanning ports, processes and containers…</div>
          ) : (
            <>
              <TabsContent value="overview">
                {/* the whole machine, so the search filter doesn't apply here */}
                <OverviewView snap={snap!} remote={remote} conflicts={conflicts} onTab={setTab} />
              </TabsContent>
              <TabsContent value="projects">
                <ProjectsView snap={view} showSystem={showSystem} conflicts={conflicts} />
              </TabsContent>
              <TabsContent value="ports">
                <PortsView snap={view} showSystem={showSystem} conflicts={conflicts} remote={remote} />
              </TabsContent>
              <TabsContent value="docker">
                <DockerView snap={view} />
              </TabsContent>
              <TabsContent value="ssh">
                <NetworkView snap={view} remote={remote} />
              </TabsContent>
            </>
          )}
          <TabsContent value="remote" keepMounted>
            <RemoteView snap={snap} hosts={remote} showSystem={showSystem} query={query} reload={loadRemote} />
          </TabsContent>
        </Tabs>
        <AddHostSheet open={addHostOpen} onOpenChange={setAddHostOpen} snap={snap} hosts={remote} onAdded={loadRemote} />
      </div>
    </CollapseContext>
    </ScanContext>
    </RefreshContext>
  );
}
