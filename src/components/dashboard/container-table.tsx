import { ArrowRightIcon } from "lucide-react";
import type { ContainerPort, ContainerSummary, PortRow } from "@/lib/collect/types";
import { count } from "@/lib/format";
import { containerGroups, containerTech, isUnhealthy, shortContainerName } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { ContainerUsage } from "./sparkline";
import { CopyPath, CopyUrl, PortLink, ProtocolTag, ProjectBadges, TechBadge, TunnelLinks } from "./cells";
import { type Column, GroupedTable } from "./grouped-table";
import { LogsButton } from "./logs";
import { ContainerGroupActions, ContainerRowActions, type RemoteHostRef } from "./stop";

/**
 * Published ports as `:host → container`. Local ones open in the browser; a remote host's are plain text
 * (they live on that host; the SSH tunnel column says how to reach them).
 */
function PublishedPorts({ ports, remote, image }: { ports: ContainerPort[]; remote: boolean; image: string }) {
  if (ports.length === 0) return <span className="text-xs text-muted-foreground">internal only</span>;
  return (
    <div className="flex flex-wrap gap-x-3">
      {ports.map((p) => (
        <span key={`${p.hostPort}/${p.proto}`} className="inline-flex items-center gap-1 text-xs">
          {remote ? (
            <span className="font-mono font-semibold tabular-nums">:{p.hostPort}</span>
          ) : (
            <>
              <PortLink port={p.hostPort} address={p.hostIp || "*"} protocol={p.protocol} className="text-xs" />
              <CopyUrl port={p.hostPort} address={p.hostIp || "*"} protocol={p.protocol} hint={image} />
              <ProtocolTag protocol={p.protocol} />
            </>
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
  // docker stats are sampled on this Mac only
  ...(remote ? [] : [{ header: "Usage", width: "w-40", align: "right" as const }]),
  { header: "Ports (host → container)" },
  ...(remote ? [{ header: "SSH tunnel (this Mac → host)", width: "w-72" }] : []),
  { header: "", width: "w-32" },
];

/**
 * Containers grouped by compose / Supabase stack, with stop controls: the Docker tab, and every remote
 * host when `host` is given (stopped over ssh; an extra column shows the local ssh tunnels to its ports).
 */
/** A container worth opening in a browser: a published port that speaks HTTP, or none published to tell. */
const servesWeb = (c: ContainerSummary) => c.ports.length === 0 || c.ports.some((p) => p.protocol === "http" || p.protocol === "https");

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
          {c.domains?.map((d) =>
            // OrbStack finds the web port and serves it over HTTPS with its own local CA; a database gets the name only
            servesWeb(c) ? (
              <a key={d} href={`https://${d}`} target="_blank" rel="noreferrer" className="block text-[11px] text-sky-600 hover:underline dark:text-sky-400">
                {d}
              </a>
            ) : (
              <span key={d} className="block text-[11px] text-muted-foreground">
                {d}
              </span>
            ),
          )}
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
        ...(host ? [] : [<ContainerUsage key="usage" cpu={c.cpu} memMB={c.memMB} usage={c.usage} />]),
        <PublishedPorts key="ports" ports={c.ports} remote={!!host} image={c.image} />,
        ...(host
          ? [
              <TunnelLinks key="tunnel" links={tunnelLinks?.(c.ports.map((p) => p.hostPort)) ?? []} />,
            ]
          : []),
        <div key="actions" className="flex justify-end">
          <LogsButton container={c} host={host} />
          <ContainerRowActions container={c} host={host} />
        </div>,
      ],
    })),
  }));

  return <GroupedTable scope={scope} columns={columns(!!host)} groups={groups} empty={empty} />;
}
