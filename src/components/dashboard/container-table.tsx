import { ArrowRightIcon } from "lucide-react";
import type { ContainerPort, ContainerSummary, PortRow } from "@/lib/collect/types";
import { count } from "@/lib/format";
import { containerGroups, containerTech, isUnhealthy, shortContainerName } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { CopyPath, PortLink, ProjectBadges, TechBadge, TunnelLinks } from "./cells";
import { type Column, GroupedTable } from "./grouped-table";
import { ContainerGroupActions, ContainerRowActions, type RemoteHostRef } from "./stop";

/**
 * Published ports as `:host → container`. Local ones open in the browser; a remote host's are plain text
 * (they live on that host; the SSH tunnel column says how to reach them).
 */
function PublishedPorts({ ports, remote }: { ports: ContainerPort[]; remote: boolean }) {
  if (ports.length === 0) return <span className="text-xs text-muted-foreground">internal only</span>;
  return (
    <div className="flex flex-wrap gap-x-3">
      {ports.map((p) => (
        <span key={`${p.hostPort}/${p.proto}`} className="inline-flex items-center gap-1 text-xs">
          {remote ? (
            <span className="font-mono font-semibold tabular-nums">:{p.hostPort}</span>
          ) : (
            <PortLink port={p.hostPort} address={p.hostIp || "*"} className="text-xs" />
          )}
          <ArrowRightIcon className="size-3 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{p.containerPort}</span>
        </span>
      ))}
    </div>
  );
}

const columns = (remote: boolean): Column[] => [
  { header: "Container", width: "w-48" },
  { header: "Image", width: remote ? "w-60" : "w-72" },
  { header: "Status", width: "w-32" },
  { header: "Ports (host → container)" },
  ...(remote ? [{ header: "SSH tunnel (this Mac → host)", width: "w-72" }] : []),
  { header: "", width: "w-16" },
];

/**
 * Containers grouped by compose / Supabase stack, with stop controls: the Docker tab, and every remote
 * host when `host` is given (stopped over ssh; an extra column shows the local ssh tunnels to its ports).
 */
export function ContainerTable({
  scope,
  containers,
  host,
  tunnelLinks,
  empty,
}: {
  scope: string;
  containers: ContainerSummary[];
  host?: RemoteHostRef;
  /** remote hosts: the local ssh tunnels that reach some of these host ports */
  tunnelLinks?: (ports: number[]) => { remotePort: number; tunnel: PortRow }[];
  empty: string;
}) {
  const groups = containerGroups(containers).map(([group, cs]) => ({
    key: group,
    title: (
      <>
        <TechBadge tech={containerTech(cs[0])} />
        <span className="font-medium">{group}</span>
        <ProjectBadges project={cs[0].project} />
        <CopyPath path={cs[0].workdir} />
      </>
    ),
    meta: (
      <>
        {count(cs.length, "container")}
        <ContainerGroupActions containers={cs} host={host} />
      </>
    ),
    rows: cs.map((c) => ({
      key: c.id,
      cells: [
        // the group header already names the stack, so drop it from each container name
        <span key="name" title={c.name} className="block font-mono text-xs break-all">
          {shortContainerName(c)}
        </span>,
        <span key="image" className="block font-mono text-xs break-all text-muted-foreground">
          {c.image}
        </span>,
        <span key="status" className="block text-xs">
          {c.status}
          {c.health && (
            <span className={cn("block", isUnhealthy(c) ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
              {c.health}
            </span>
          )}
        </span>,
        <PublishedPorts key="ports" ports={c.ports} remote={!!host} />,
        ...(host
          ? [
              <TunnelLinks key="tunnel" links={tunnelLinks?.(c.ports.map((p) => p.hostPort)) ?? []} />,
            ]
          : []),
        <ContainerRowActions key="actions" container={c} host={host} />,
      ],
    })),
  }));

  return <GroupedTable scope={scope} columns={columns(!!host)} groups={groups} empty={empty} />;
}
