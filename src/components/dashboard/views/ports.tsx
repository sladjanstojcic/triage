import { Fragment } from "react";
import type { RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { type Conflicts, displayCommand, sortedPorts } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { Command, ConflictBadge, CopyPath, Muted, OriginLine, PortCell, ProjectBadges, RemoteHint, TechBadge } from "../cells";
import { type Column, GroupedTable } from "../grouped-table";
import { ContainerActionButton, PortStop } from "../stop";

const COLUMNS: Column[] = [
  { header: "Port", width: "w-28" },
  { header: "Type", width: "w-32" },
  { header: "What" },
  { header: "Project / folder", width: "w-80" },
  { header: "PID / ID", width: "w-28", align: "right" },
  { header: "", width: "w-10" },
];

/** Every listening port in one table, by number: processes, containers and ssh forwards alike. */
export function PortsView({
  snap,
  showSystem,
  conflicts,
  remote,
}: {
  snap: Snapshot;
  showSystem: boolean;
  conflicts: Conflicts;
  remote?: RemoteSnapshot[];
}) {
  const procs = new Map(snap.processes.map((p) => [p.pid, p]));
  const containers = new Map(snap.containers.map((c) => [c.id, c]));

  const rows = sortedPorts(snap, showSystem).map((p) => ({
    key: `${p.pid}-${p.port}-${p.address}`,
    className: cn(conflicts.has(p.port) && "bg-destructive/5"),
    cells: [
      <PortCell key="port" port={p.port} address={p.address} />,
      <TechBadge key="type" tech={p.tech ?? p.processName} />,
      <Fragment key="what">
        <ConflictBadge row={p} conflicts={conflicts} />
        <Command text={p.ownerKind === "process" ? displayCommand(p, procs) : p.owner} />
        {p.ownerKind === "process" && <OriginLine origin={procs.get(p.pid)?.origin} />}
        <RemoteHint row={p} remote={remote} />
      </Fragment>,
      <Fragment key="project">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {p.project && (
            <span className="text-sm font-medium break-words">
              {p.project.name}
              {p.project.subpath ? ` › ${p.project.subpath}` : ""}
            </span>
          )}
          <ProjectBadges project={p.project} />
        </div>
        <CopyPath path={p.folder} />
      </Fragment>,
      // docker ports: the pid is just the Docker/OrbStack proxy, so show and stop the container instead
      <Muted key="pid">{p.containerId?.slice(0, 12) ?? p.pid}</Muted>,
      p.containerId && containers.has(p.containerId) ? (
        <ContainerActionButton key="stop" action="stop" containers={[containers.get(p.containerId)!]} />
      ) : (
        <PortStop key="stop" row={p} procs={procs} />
      ),
    ],
  }));

  return (
    <GroupedTable
      flat
      scope="ports"
      columns={COLUMNS}
      groups={[{ key: "ports", title: null, rows }]}
      empty="No listening ports match."
    />
  );
}
