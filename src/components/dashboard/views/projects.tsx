import { BoxIcon, FolderIcon, NetworkIcon } from "lucide-react";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import type { Container, PortRow, Snapshot } from "@/lib/collect/types";
import { count, formatMem, humanElapsed } from "@/lib/format";
import { type Conflicts, containerGroups, containerTech, displayCommand, groupByProject, isUnhealthy, portPref, type ProjectGroup, shortContainerName } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { Command, ConflictBadge, CopyPath, CopyUrl, Muted, ProtocolTag, OriginLine, PortCell, PortLink, ProjectBadges, TechBadge } from "../cells";
import { type Column, GroupedTable, type GroupRow, type TableGroup } from "../grouped-table";
import { PortMenu, PortNote } from "../port-menu";
import { ContainerActionButton, PortStop } from "../stop";

const COLUMNS: Column[] = [
  { header: "Port", width: "w-28" },
  { header: "Type", width: "w-32" },
  { header: "What" },
  { header: "Uptime", width: "w-24", align: "right" },
  { header: "Usage", width: "w-24", align: "right" },
  { header: "PID", width: "w-20", align: "right" },
  { header: "", width: "w-16" },
];

/** Memory, with CPU underneath: what a server or stack costs right now. */
function Usage({ memMB, cpu }: { memMB: number; cpu: number }) {
  return (
    <Muted>
      {formatMem(memMB)}
      <span className="block text-[11px]">{Math.round(cpu * 10) / 10}% CPU</span>
    </Muted>
  );
}

function GroupIcon({ icon }: { icon: ProjectGroup["icon"] }) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  if (icon === "docker") return <BoxIcon className={cls} />;
  if (icon === "other") return <NetworkIcon className={cls} />;
  return <FolderIcon className={cls} />;
}

/** Everything running locally, one group per project folder. */
export function ProjectsView({ snap, showSystem, conflicts }: { snap: Snapshot; showSystem: boolean; conflicts: Conflicts }) {
  const procs = new Map(snap.processes.map((p) => [p.pid, p]));

  const portRow = (p: PortRow): GroupRow => {
    const proc = procs.get(p.pid);
    const pref = portPref(snap, p.port);
    return {
      key: `${p.pid}-${p.port}`,
      className: cn(conflicts.has(p.port) && "bg-destructive/5"),
      cells: [
        <PortCell key="port" port={p.port} address={p.address} protocol={p.protocol} pinned={pref.pinned} hint={`${p.tech ?? ""} ${p.owner}`} />,
        <TechBadge key="type" tech={p.tech} />,
        <Fragment key="what">
          <ConflictBadge row={p} conflicts={conflicts} />
          {p.project?.subpath && <span className="block font-mono text-xs font-medium break-all">{p.project.subpath}</span>}
          <Command text={displayCommand(p, procs)} />
          <PortNote pref={pref} />
          <OriginLine origin={proc?.origin} />
        </Fragment>,
        proc && <Muted key="uptime">{humanElapsed(proc.elapsed)}</Muted>,
        // the whole server: dev CLI, server and workers, which is what a kill frees
        proc && <Usage key="usage" memMB={proc.stopTree.memMB} cpu={proc.stopTree.cpu} />,
        <Muted key="pid">{p.pid}</Muted>,
        <div key="actions" className="flex justify-end">
          <PortMenu port={p.port} pref={pref} />
          <PortStop row={p} procs={procs} />
        </div>,
      ],
    };
  };

  /** One row per compose / Supabase stack, its published ports inline. */
  const stackRow = ([group, cs]: [string, Container[]]): GroupRow => {
    const name = cs[0].kind === "container" ? cs[0].name : group;
    const unhealthy = cs.filter(isUnhealthy);
    const ports = cs.flatMap((c) => c.ports.map((p) => ({ c, p }))).sort((a, b) => a.p.hostPort - b.p.hostPort);
    return {
      key: `docker:${group}`,
      cells: [
        <span key="port" className="text-xs text-muted-foreground">
          {count(ports.length, "port") || "no ports"}
        </span>,
        <TechBadge key="type" tech={containerTech(cs[0])} />,
        <Fragment key="what">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-medium break-all">{name}</span>
            <span className="text-xs text-muted-foreground">{count(cs.length, "container")}</span>
            {unhealthy.length > 0 && (
              <Badge variant="destructive">{unhealthy.map((c) => `${shortContainerName(c)}: ${c.health}`).join(", ")}</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {ports.map(({ c, p }) => (
              <span key={`${c.id}-${p.hostPort}`} className="inline-flex items-center gap-1.5 text-xs">
                <PortLink port={p.hostPort} address={p.hostIp || "*"} protocol={p.protocol} className="text-xs" />
                <CopyUrl port={p.hostPort} address={p.hostIp || "*"} protocol={p.protocol} hint={`${c.image} ${c.name}`} />
                <ProtocolTag protocol={p.protocol} />
                <span className="text-muted-foreground">{shortContainerName(c)}</span>
              </span>
            ))}
          </div>
        </Fragment>,
        <Muted key="uptime">{cs[0].status.replace(/^Up /, "")}</Muted>,
        cs.some((c) => c.memMB !== undefined) ? (
          <Usage key="usage" memMB={cs.reduce((sum, c) => sum + (c.memMB ?? 0), 0)} cpu={cs.reduce((sum, c) => sum + (c.cpu ?? 0), 0)} />
        ) : null,
        null,
        <ContainerActionButton key="stop" action="stop" containers={cs} />,
      ],
    };
  };

  const groups: TableGroup[] = groupByProject(snap, showSystem).map((g) => ({
    key: g.key,
    className: cn(g.project?.missing && "bg-destructive/10"),
    title: (
      <>
        <GroupIcon icon={g.icon} />
        <span className="font-medium">{g.title}</span>
        <ProjectBadges project={g.project} />
        <CopyPath path={g.folder} />
      </>
    ),
    meta: [
      count(g.ports.length, "port"),
      count(g.containers.length, "container"),
      g.usage.memMB > 0 && `${formatMem(g.usage.memMB)} · ${g.usage.cpu}% CPU`,
    ]
      .filter(Boolean)
      .join(" · "),
    rows: [...g.ports.map(portRow), ...containerGroups(g.containers).map(stackRow)],
  }));

  return <GroupedTable scope="projects" columns={COLUMNS} groups={groups} empty="Nothing is listening. Enjoy the quiet." />;
}
