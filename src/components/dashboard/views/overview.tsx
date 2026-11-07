import { ArrowRightIcon, BatteryChargingIcon, BatteryIcon, CheckCircle2Icon, CircleAlertIcon, InfoIcon, LaptopIcon, ServerIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type AttentionItem, attentionItems, usageLevel } from "@/lib/attention";
import type { DockerDiskRow, MachineInfo, RemoteSnapshot, Snapshot, Usage } from "@/lib/collect/types";
import { formatBytes, since } from "@/lib/format";
import { type Conflicts, isUp, projectCount } from "@/lib/grouping";
import { type Tab, tabLabel } from "@/lib/tabs";
import { cn } from "@/lib/utils";


/** This Mac and every remote host at a glance: what needs attention first, then one card per machine. */
export function OverviewView({
  snap,
  remote,
  conflicts,
  onTab,
}: {
  snap: Snapshot;
  remote?: RemoteSnapshot[];
  conflicts: Conflicts;
  onTab: (tab: Tab) => void;
}) {
  const items = attentionItems(snap, remote, conflicts);
  const devServers = snap.ports.filter((p) => p.ownerKind === "process" && !p.system).length;
  const projects = projectCount(snap);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">This machine</h2>
          <MachineCard
            icon={<LaptopIcon className="size-4 text-muted-foreground" />}
            machine={snap.machine}
            dockerDisk={snap.dockerDisk}
            counts={[
              { n: devServers, word: "dev server", tab: "projects" },
              { n: projects, word: "project", tab: "projects" },
              { n: snap.containers.filter(isUp).length, word: "container", tab: "docker" },
              { n: snap.ssh.filter((c) => c.role === "tunnel").length, word: "SSH tunnel", tab: "ssh" },
              { n: snap.tunnels.length, word: "public tunnel", tab: "ssh" },
            ]}
            onTab={onTab}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Remote</h2>
          {remote === undefined ? (
            <p className="text-sm text-muted-foreground">Probing remote hosts…</p>
          ) : remote.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No remote hosts.{" "}
              <Button variant="link" size="xs" className="px-0" onClick={() => onTab("remote")}>
                Add one on the Remote tab
              </Button>
            </p>
          ) : (
            remote.map((h) => (
              <MachineCard
                key={h.id}
                icon={<ServerIcon className="size-4 text-muted-foreground" />}
                machine={h.machine ?? { hostname: h.name }}
                name={h.name}
                unreachable={h.ok ? undefined : (h.error ?? "unreachable")}
                dockerDisk={h.dockerDisk}
                counts={[
                  { n: h.listeners.filter((l) => !l.system && !l.container).length, word: "port", tab: "remote" },
                  { n: h.containers.filter(isUp).length, word: "container", tab: "remote" },
                ]}
                onTab={onTab}
              />
            ))
          )}
        </section>
      </div>
      {/* problems first on narrow screens, beside the machines on wide ones */}
      <aside className="order-first min-w-0 lg:order-none lg:col-span-2">
        <Attention items={items} machines={1 + (remote?.length ?? 0)} onTab={onTab} />
      </aside>
    </div>
  );
}

const LEVEL = {
  error: { icon: CircleAlertIcon, className: "text-destructive" },
  warn: { icon: TriangleAlertIcon, className: "text-amber-600 dark:text-amber-400" },
  info: { icon: InfoIcon, className: "text-muted-foreground" },
};

function Attention({ items, machines, onTab }: { items: AttentionItem[]; machines: number; onTab: (tab: Tab) => void }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
        Nothing needs attention on {machines === 1 ? "this Mac" : `${machines} machines`}.
      </p>
    );
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => {
            const { icon: Icon, className } = LEVEL[item.level];
            return (
              <li key={item.key} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{item.text}</span>
                    <span className="font-mono text-xs text-muted-foreground">{item.machine}</span>
                  </div>
                  {item.detail && <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{item.detail}</p>}
                </div>
                {item.tab && (
                  <Button variant="link" size="xs" className="shrink-0" onClick={() => onTab(item.tab!)}>
                    {tabLabel(item.tab)}
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** A labelled bar, coloured by usageLevel: amber from 80%, red from 90%. */
function Meter({ label, ratio, value }: { label: string; ratio: number; value: string }) {
  const level = usageLevel(ratio);
  const tone = level === "error" ? "bg-destructive" : level === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }} />
      </div>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

const usageMeter = (label: string, u: Usage | undefined, binary: boolean) =>
  u && u.total > 0 ? (
    <Meter
      label={label}
      ratio={u.used / u.total}
      value={`${formatBytes(u.used, binary)} / ${formatBytes(u.total, binary)} · ${Math.round((u.used / u.total) * 100)}%`}
    />
  ) : null;

function MachineCard({
  icon,
  machine: m,
  name,
  unreachable,
  dockerDisk,
  counts,
  onTab,
}: {
  icon: React.ReactNode;
  machine: MachineInfo;
  /** the name used in Triage when it differs from the hostname (a remote host's ssh alias) */
  name?: string;
  unreachable?: string;
  dockerDisk?: DockerDiskRow[];
  counts: { n: number; word: string; tab: Tab }[];
  onTab: (tab: Tab) => void;
}) {
  const docker = (dockerDisk ?? []).filter((r) => r.size > 0);
  const dockerSize = docker.reduce((s, r) => s + r.size, 0);
  const dockerFree = docker.reduce((s, r) => s + r.reclaimable, 0);
  return (
    <Card size="sm" className={cn(unreachable && "border-destructive/40")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {icon}
          <span>{name ?? m.hostname}</span>
          {name && m.hostname !== name && <span className="font-mono text-xs font-normal text-muted-foreground">{m.hostname}</span>}
          {unreachable ? <Badge variant="destructive">unreachable</Badge> : m.os && <Badge variant="secondary">{m.os}</Badge>}
          {m.bootedAt && <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">up {since(m.bootedAt)}</span>}
        </CardTitle>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {unreachable ? (
            <span className="font-mono">{unreachable}</span>
          ) : (
            <>
              {[m.cpu, m.cores && `${m.cores} cores`].filter(Boolean).join(" · ")}
              {m.battery && (
                <span className="inline-flex items-center gap-1">
                  · {m.battery.charging ? <BatteryChargingIcon className="size-3.5" /> : <BatteryIcon className="size-3.5" />}
                  {m.battery.percent}%{m.battery.remaining ? `, ${m.battery.remaining} left` : m.battery.charging ? ", charging" : ""}
                </span>
              )}
            </>
          )}
        </p>
      </CardHeader>
      {!unreachable && (
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            {m.load && m.cores && <Meter label="CPU load" ratio={m.load[0] / m.cores} value={`${m.load[0].toFixed(1)} / ${m.cores} cores`} />}
            {usageMeter("Memory", m.memory, true)}
            {usageMeter("Swap", m.swap, true)}
            {usageMeter("Disk", m.disk, false)}
          </div>
          {docker.length > 0 && (
            <div className="text-xs">
              <span className="font-medium">Docker {formatBytes(dockerSize)}</span>
              {dockerFree > 0 && <span className="text-muted-foreground"> · {formatBytes(dockerFree)} reclaimable</span>}
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
                {docker.map((r) => (
                  <span key={r.type}>
                    {r.type.toLowerCase()} {formatBytes(r.size)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {counts.map((c) => (
              <Button key={c.word} variant="outline" size="xs" onClick={() => onTab(c.tab)}>
                <span className="font-mono font-semibold tabular-nums">{c.n}</span>
                <span className="text-muted-foreground">{c.n === 1 ? c.word : `${c.word}s`}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
