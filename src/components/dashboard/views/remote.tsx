import { ChevronRightIcon, Loader2Icon, ServerIcon, Trash2Icon } from "lucide-react";
import { Fragment, use, useState } from "react";
import { removeRemoteHost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PortRow, RemoteListener, RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { count, shortUptime } from "@/lib/format";
import { isUp, localTunnel } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { BindBadge, Command, CopyPath, Empty, OriginLine, TunnelLinks } from "../cells";
import { ConfirmDialog } from "../confirm";
import { ContainerTable } from "../container-table";
import { RefreshContext, RemotePortStop } from "../stop";
import { CollapseContext, type Column, GroupedTable, groupKey } from "../grouped-table";

const PORT_COLUMNS: Column[] = [
  { header: "Port", width: "w-24" },
  { header: "Bind", width: "w-36" },
  { header: "Process" },
  { header: "Folder", width: "w-60" },
  { header: "SSH tunnel (this Mac → host)", width: "w-72" },
  { header: "", width: "w-10" },
];

/** VPS hosts probed over ssh, one section per host. */
export function RemoteView({
  snap,
  hosts,
  showSystem,
  query,
  reload: load,
}: {
  snap?: Snapshot;
  hosts?: RemoteSnapshot[];
  showSystem: boolean;
  query: string;
  reload: () => Promise<void>;
}) {
  // the host the remove confirmation is about; kept after closing so the dialog text doesn't blank mid-animation
  const [toRemove, setToRemove] = useState<RemoteSnapshot>();
  const [removeOpen, setRemoveOpen] = useState(false);

  const shown = (hosts ?? []).flatMap((host) => {
    const rows = visibleRows(host, showSystem, query);
    return rows ? [{ host, rows }] : [];
  });

  // stop buttons in this view re-probe the hosts, not the local machine
  return (
    <RefreshContext value={load}>
    <div className="space-y-4">
      {hosts === undefined ? (
        <Empty>
          <Loader2Icon className="mx-auto size-4 animate-spin" />
        </Empty>
      ) : hosts.length === 0 ? (
        <Empty>No remote hosts yet. Use Add host to probe a VPS over ssh.</Empty>
      ) : shown.length === 0 ? (
        <Empty>Nothing on the remote hosts matches.</Empty>
      ) : (
        shown.map(({ host: h, rows }) => (
          <HostSection
            key={h.id}
            host={h}
            rows={rows}
            localPorts={snap?.ports ?? []}
            onRemove={() => {
              setToRemove(h);
              setRemoveOpen(true);
            }}
          />
        ))
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${toRemove?.name ?? "host"}?`}
        description={
          <p>
            Triage stops probing <code className="font-mono">{toRemove?.sshTarget}</code> and forgets it. The host itself is not
            touched; you can add it again later.
          </p>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const res = toRemove ? await removeRemoteHost(toRemove.id) : {};
          if (!res.error) await load();
          return res;
        }}
      />
    </div>
    </RefreshContext>
  );
}

type HostRows = { listeners: RemoteListener[]; containers: RemoteSnapshot["containers"]; hidden: number };

/**
 * What a host's section shows: its ports minus system services (unless shown) and minus container ports
 * (the Containers table lists those), narrowed by the search unless the host itself matches.
 * Null hides the host: the search matched nothing on it.
 */
function visibleRows(h: RemoteSnapshot, showSystem: boolean, query: string): HostRows | null {
  const own = h.listeners.filter((l) => !l.container);
  let listeners = showSystem ? own : own.filter((l) => !l.system);
  const hidden = own.length - listeners.length;
  let containers = h.containers;
  const needle = query.trim().toLowerCase();
  const hit = (v: unknown) => JSON.stringify(v).toLowerCase().includes(needle);
  if (needle && !hit([h.name, h.hostname, h.sshTarget])) {
    listeners = listeners.filter(hit);
    containers = containers.filter(hit);
    if (listeners.length === 0 && containers.length === 0) return null;
  }
  return { listeners, containers, hidden };
}

/** One machine: a header with its status and actions, then its ports and its containers as separate tables. */
function HostSection({
  host: h,
  rows,
  localPorts,
  onRemove,
}: {
  host: RemoteSnapshot;
  rows: HostRows;
  /** this Mac's ports, to find the ssh tunnels that reach this host */
  localPorts: PortRow[];
  onRemove: () => void;
}) {
  // the SSH tunnel column of both tables: which of these host ports a local ssh forward reaches
  const tunnelLinks = (ports: number[]) =>
    ports.flatMap((remotePort) => {
      const tunnel = localTunnel(h, remotePort, localPorts);
      return tunnel ? [{ remotePort, tunnel }] : [];
    });
  const { collapsed, toggle } = use(CollapseContext);
  const key = groupKey("remote", String(h.id));
  const open = !collapsed.has(key);
  const { listeners, containers, hidden } = rows;

  return (
    <section className="space-y-2">
      <div
        className={cn(
          "flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 hover:bg-muted/60",
          !h.ok && "border-destructive/40 bg-destructive/10",
        )}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) toggle(key);
        }}
      >
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="font-medium">{h.name}</h3>
        {h.hostname && h.hostname !== h.name && <span className="font-mono text-xs text-muted-foreground">{h.hostname}</span>}
        {h.ok ? <Badge variant="secondary">online</Badge> : <Badge variant="destructive">unreachable</Badge>}
        {h.ok && !h.rootView && (
          <Badge variant="outline" title="Add passwordless sudo for ss/readlink/docker on the host to see other users' processes">
            user view
          </Badge>
        )}
        <span className="min-w-0 font-mono text-xs text-muted-foreground" title={h.ok ? h.uptime : undefined}>
          {h.ok ? h.uptime && shortUptime(h.uptime) : h.error}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {[
            count(listeners.length, "port"),
            count(containers.filter(isUp).length, "container"),
            containers.some((c) => !isUp(c)) && `${containers.filter((c) => !isUp(c)).length} stopped`,
          ]
            .filter(Boolean)
            .join(" · ")}
          {hidden > 0 && <span>({hidden} system hidden)</span>}
          <Button variant="ghost" size="icon-xs" title="Remove host" onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {open && h.ok && (
        <>
          {listeners.length === 0 && containers.length === 0 && (
            <Empty>{hidden > 0 ? "Only system services are listening." : "Nothing listening and no containers running."}</Empty>
          )}
          {listeners.length > 0 && (
            <GroupedTable
              flat
              scope="remote-ports"
              columns={PORT_COLUMNS}
              empty={null}
              groups={[
                {
                  key: String(h.id),
                  title: null,
                  rows: listeners.map((l) => ({
                    key: `${l.address}:${l.port}`,
                    cells: [
                      <span key="port" className="font-mono text-sm font-semibold tabular-nums">:{l.port}</span>,
                      <BindBadge key="bind" address={l.address} />,
                      <Fragment key="what">
                        <Command
                          className="text-foreground"
                          text={l.command ?? l.process ?? "owned by another user (needs passwordless sudo to name it)"}
                        />
                        <OriginLine origin={l.origin} />
                      </Fragment>,
                      <CopyPath key="folder" path={l.cwd} />,
                      <TunnelLinks key="tunnel" links={tunnelLinks([l.port])} />,
                      <RemotePortStop key="stop" listener={l} host={h} />,
                    ],
                  })),
                },
              ]}
            />
          )}
          {containers.length > 0 && (
            <ContainerTable scope={`remote-docker-${h.id}`} containers={containers} host={h} tunnelLinks={tunnelLinks} empty="" />
          )}
        </>
      )}
    </section>
  );
}
