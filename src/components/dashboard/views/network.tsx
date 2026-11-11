import { ArrowRightIcon, GlobeIcon, NetworkIcon, ServerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RemoteSnapshot, Snapshot, SshConnection } from "@/lib/collect/types";
import { count, humanElapsed, isLoopback } from "@/lib/format";
import { sshMachines, sshUser } from "@/lib/grouping";
import { cn } from "@/lib/utils";
import { Command, Muted, PortLink, RemoteHint, TechBadge } from "../cells";
import { type Column, GroupedTable } from "../grouped-table";
import { KillButton, SshStop } from "../stop";

const SSH_COLUMNS: Column[] = [
  { header: "Connection", width: "w-56" },
  { header: "Forwards (this Mac → host) / used by" },
  { header: "PID", width: "w-20", align: "right" },
  { header: "Up", width: "w-20", align: "right" },
  { header: "", width: "w-10" },
];

/**
 * A tunnel's forwards in aligned columns, in the same form as the Remote tab's SSH tunnel column:
 * "-L" → local link, the port it reaches on the host, what listens there; "-R" and "-D" get their own words.
 */
function ForwardList({ conn, snap, remote }: { conn: SshConnection; snap: Snapshot; remote?: RemoteSnapshot[] }) {
  return (
    <div className="grid grid-cols-[max-content_max-content_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-xs">
      {conn.forwards.map((f) => {
        const key = `${f.kind}${f.spec}`;
        const muted = "font-mono text-muted-foreground";
        if (f.kind === "L" && f.localPort) {
          // the local port row for this forward knows what it reaches on the remote host
          const row = snap.ports.find((r) => r.ownerKind === "ssh" && r.pid === conn.pid && r.port === f.localPort);
          const where = f.destHost && !isLoopback(f.destHost) ? ` on ${f.destHost}` : "";
          return (
            <div key={key} className="contents">
              <PortLink port={f.localPort} address={f.bind ?? "127.0.0.1"} tunnel className="text-xs" />
              <span className={muted}>
                → :{f.destPort}
                {where}
              </span>
              {/* always a third cell: RemoteHint renders nothing until the host is probed */}
              <span>{row && <RemoteHint row={row} remote={remote} />}</span>
            </div>
          );
        }
        if (f.kind === "R" && f.remotePort) {
          return (
            <div key={key} className="contents">
              <span className="font-mono font-semibold">host :{f.remotePort}</span>
              <span className={muted}>
                → this Mac {f.destHost && !isLoopback(f.destHost) ? f.destHost : ""}:{f.destPort}
              </span>
              <span className="text-muted-foreground">reverse tunnel: the host reaches this Mac</span>
            </div>
          );
        }
        if (f.kind === "D" && f.localPort) {
          return (
            <div key={key} className="contents">
              <span className="font-mono font-semibold">:{f.localPort}</span>
              <span className={muted}>SOCKS proxy</span>
              <span className="text-muted-foreground">traffic through {conn.target}</span>
            </div>
          );
        }
        return (
          <span key={key} className="col-span-3 font-mono text-muted-foreground">
            -{f.kind} {f.spec}
          </span>
        );
      })}
    </div>
  );
}

/** Outgoing ssh connections, public tunnel clients, and the tailnet. */
export function NetworkView({ snap, remote }: { snap: Snapshot; remote?: RemoteSnapshot[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="lg:col-span-2">
        <GroupedTable
          scope="ssh"
          columns={SSH_COLUMNS}
          empty="No outgoing SSH connections."
          groups={sshMachines(snap.ssh, remote).map((m) => ({
            key: m.key,
            title: (
              <>
                <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{m.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{m.address}</span>
              </>
            ),
            meta: count(m.connections.length, "connection"),
            rows: m.connections.map((c) => ({
              key: String(c.pid),
              cells: [
                <div key="conn" className="space-y-1">
                  <span className="block font-mono text-sm font-semibold break-all">{c.target}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.role === "tunnel" ? (
                      <TechBadge tech="SSH tunnel" />
                    ) : (
                      <Badge variant="outline">{c.role === "multiplexed" ? "shared connection" : "session"}</Badge>
                    )}
                    {c.managedBy && <span className="text-[11px] text-muted-foreground">{c.managedBy}</span>}
                  </div>
                </div>,
                c.forwards.length > 0 ? (
                  <ForwardList key="what" conn={c} snap={snap} remote={remote} />
                ) : (
                  <div key="what">
                    {sshUser(c.command) && <span className="block text-xs">used by {sshUser(c.command)}</span>}
                    <Command text={c.command} />
                  </div>
                ),
                <Muted key="pid">{c.pid}</Muted>,
                <Muted key="up">{humanElapsed(c.elapsed)}</Muted>,
                <SshStop
                  key="stop"
                  pid={c.pid}
                  stopPid={c.stopPid}
                  target={c.target}
                  note={
                    c.role === "multiplexed"
                      ? `Everything sharing this connection${sshUser(c.command) ? ` (${sshUser(c.command)})` : ""} may drop too.`
                      : c.forwards.length > 0
                        ? `${count(c.forwards.length, "forward")} close.`
                        : undefined
                  }
                />,
              ],
            })),
          }))}
        />
      </section>

      {snap.tunnels.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground lg:col-span-2">
          <GlobeIcon className="size-4" /> No tunnels running (cloudflared, ngrok, localtunnel, bore, zrok, Tailscale
          serve/funnel, kubectl port-forward).
        </p>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GlobeIcon className="size-4 text-muted-foreground" /> Tunnels
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {snap.tunnels.map((t, i) => (
                <li key={`${t.kind}-${t.pid ?? i}-${t.publicUrl ?? ""}`} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{t.kind}</Badge>
                    {t.publicUrl && (
                      <a href={t.publicUrl} target="_blank" rel="noreferrer" className="font-mono text-sm text-sky-600 hover:underline dark:text-sky-400">
                        {t.publicUrl}
                      </a>
                    )}
                    {t.target && (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <ArrowRightIcon className="size-3" /> {t.target}
                      </span>
                    )}
                    {t.pid && (
                      <span className="ml-auto">
                        <KillButton
                          pid={t.pid}
                          title={`Kill ${t.kind}`}
                          description={
                            <>
                              Sends SIGTERM to {t.kind} (pid {t.pid}). {t.publicUrl ? "The public URL stops working." : "What it forwards stops answering."}
                            </>
                          }
                        />
                      </span>
                    )}
                  </div>
                  <Command text={t.detail} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card size="sm" className={cn(snap.tunnels.length === 0 && "lg:col-span-2")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NetworkIcon className="size-4 text-muted-foreground" /> Tailscale
          </CardTitle>
          {snap.tailscale && <span className="font-mono text-xs text-muted-foreground">{snap.tailscale.self}</span>}
        </CardHeader>
        <CardContent>
          {!snap.tailscale ? (
            <p className="text-sm text-muted-foreground">Tailscale not running.</p>
          ) : (
            <ul className="space-y-1">
              {snap.tailscale.peers.map((p) => (
                <li key={p.dnsName} className="flex items-center gap-2 text-sm">
                  <span className={cn("size-2 rounded-full", p.online ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                  <span className={cn("font-medium", !p.online && "text-muted-foreground")}>{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.ip}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{p.os}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
