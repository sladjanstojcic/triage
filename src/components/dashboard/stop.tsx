import { PlayIcon, RotateCcwIcon, SquareIcon, UnplugIcon, XIcon } from "lucide-react";
import { createContext, use, useState } from "react";
import { toast } from "sonner";
import { containerAction, stopProcess, stopRemoteProcess } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { ContainerAction, ContainerSummary, LocalProcess, PortRow, RemoteListener, RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { count, tildify } from "@/lib/format";
import { isUp } from "@/lib/grouping";
import { containerImpact, type Impact, processImpact, remoteImpact } from "@/lib/impact";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm";

/** Lets any action button trigger an immediate re-scan after it acts. */
export const RefreshContext = createContext<() => void>(() => {});

/** The latest scans, so a confirmation can say what else a stop takes down. */
export const ScanContext = createContext<{ snap?: Snapshot; remote?: RemoteSnapshot[] }>({});

/** "Also goes down": other ports, child processes, and tunnels or forwards left pointing at nothing. */
function ImpactNote({ impact, port, localTunnels = [] }: { impact?: Impact; port?: number; localTunnels?: PortRow[] }) {
  const ports = (impact?.ports ?? []).filter((r) => r.port !== port);
  const lines = [
    ports.length > 0 && `${count(ports.length, "more port")}: ${[...new Set(ports.map((r) => `:${r.port}`))].join(" ")}`,
    !!impact?.otherProcesses &&
      `${impact.otherProcesses} more ${impact.otherProcesses === 1 ? "process" : "processes"} of this server (dev CLI, workers, watchers)`,
    ...(impact?.tunnels ?? []).map((t) => `${t.kind}${t.publicUrl ? ` ${t.publicUrl}` : ""} stops working`),
    ...(impact?.reverseForwards ?? []).map((f) => `ssh -R ${f.spec} on ${f.target} stops working`),
    ...localTunnels.map((r) => `local tunnel :${r.port} (ssh ${r.sshTarget}) leads nowhere`),
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
      <p className="font-medium">Also goes down</p>
      <ul className="mt-1 list-disc pl-4">
        {lines.map((l) => (
          <li key={l as string}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/** A remote host whose processes and containers are acted on over ssh. */
export type RemoteHostRef = { id: number; name: string };

type Icon = typeof SquareIcon;

/**
 * The one confirm-then-act control behind every action: a compact icon (or a labelled button) that opens a
 * confirmation, runs the action, toasts the result and re-scans. `force` adds a second "Force kill" choice.
 */
function ActionButton({
  icon: Icon,
  filled = false,
  title,
  description,
  label,
  confirmLabel,
  destructive = true,
  force = false,
  run,
  done,
}: {
  icon: Icon;
  /** solid glyph (stop ■, start ▶) rather than an outline */
  filled?: boolean;
  title: string;
  description: React.ReactNode;
  /** text button instead of the compact icon */
  label?: string;
  confirmLabel: string;
  destructive?: boolean;
  force?: boolean;
  run: (force: boolean) => Promise<{ error?: string }>;
  done: (force: boolean) => string;
}) {
  const refresh = use(RefreshContext);
  const [open, setOpen] = useState(false);

  const act = (forced: boolean) => async () => {
    const res = await run(forced);
    if (!res.error) {
      toast.success(done(forced));
      // give the process or container a moment to change state before re-scanning
      setTimeout(refresh, 600);
    }
    return res;
  };

  return (
    <>
      {label ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Icon data-icon="inline-start" className={cn(filled && "fill-current")} /> {label}
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" title={title} aria-label={title} onClick={() => setOpen(true)}>
          <Icon className={cn(filled && "fill-current")} />
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onConfirm={act(false)}
        secondary={force ? { label: "Force kill", title: "SIGKILL: no cleanup", onConfirm: act(true) } : undefined}
      />
    </>
  );
}

/** Kill a process: SIGTERM, or SIGKILL with "Force kill". On this Mac, or on a remote host over ssh. */
export function KillButton({
  pid,
  host,
  title,
  description,
}: {
  pid: number;
  host?: RemoteHostRef;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <ActionButton
      icon={XIcon}
      title={title}
      description={description}
      confirmLabel="Kill"
      force
      run={(force) => (host ? stopRemoteProcess(host.id, pid, force) : stopProcess(pid, force))}
      done={(force) => `Sent ${force ? "SIGKILL" : "SIGTERM"} to pid ${pid}${host ? ` on ${host.name}` : ""}`}
    />
  );
}

/** Disconnect an ssh connection; stops the autossh supervisor when there is one, so it doesn't reconnect. */
export function SshStop({ pid, stopPid, target, note }: { pid: number; stopPid: number; target: string; note?: string }) {
  return (
    <ActionButton
      icon={UnplugIcon}
      title={`Disconnect ${target}`}
      description={
        <>
          Kills {stopPid !== pid ? `the autossh supervisor (pid ${stopPid}) and its ssh (pid ${pid})` : `ssh pid ${pid}`}.
          {note && ` ${note}`}
        </>
      }
      confirmLabel="Disconnect"
      run={() => stopProcess(stopPid)}
      done={() => `Disconnected ${target}`}
    />
  );
}

function KillDescription({ pid, viaCli, port, command, folder, host, children }: {
  pid: number;
  viaCli: boolean;
  port: number;
  command?: string;
  folder?: string;
  host?: string;
  /** the impact note */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p>
        Sends SIGTERM to pid {pid}
        {host && ` on ${host}`}
        {viaCli && ` — the dev CLI that started the server on :${port}`}.
      </p>
      {command && <code className="block rounded bg-muted p-2 font-mono text-xs break-all">{tildify(command)}</code>}
      {folder && <p className="font-mono text-xs">{tildify(folder)}</p>}
      {children}
    </div>
  );
}

/** Kill control for a local port row: the dev server (or the CLI that started it), or the ssh tunnel behind it. */
export function PortStop({ row, procs }: { row: PortRow; procs: Map<number, LocalProcess> }) {
  if (!row.stopPid) return null;
  if (row.ownerKind === "ssh") {
    return (
      <SshStop
        pid={row.pid}
        stopPid={row.stopPid}
        target={row.sshTarget ?? row.owner}
        note={`Every forward on this connection closes, not just :${row.port}.`}
      />
    );
  }
  const viaCli = row.stopPid !== row.pid;
  return (
    <ProcessStop
      stopPid={row.stopPid}
      port={row.port}
      title={`Kill :${row.port}${row.project ? ` (${row.project.name})` : ""}`}
      viaCli={viaCli}
      command={viaCli ? procs.get(row.pid)?.parentCommand : row.owner}
      folder={row.folder}
    />
  );
}

/** Kill a local server by its stop pid, saying what else goes down with it. Used by port rows and the Overview. */
export function ProcessStop({ stopPid, port, title, viaCli, command, folder }: {
  stopPid: number;
  port: number;
  title: string;
  viaCli: boolean;
  command?: string;
  folder?: string;
}) {
  const { snap } = use(ScanContext);
  return (
    <KillButton
      pid={stopPid}
      title={title}
      description={
        <KillDescription pid={stopPid} viaCli={viaCli} port={port} command={command} folder={folder}>
          <ImpactNote impact={snap && processImpact(snap, stopPid)} port={port} />
        </KillDescription>
      }
    />
  );
}

/** Kill control for a port on a remote host; the server re-checks the pid against a fresh probe. */
export function RemotePortStop({ listener: l, host }: { listener: RemoteListener; host: RemoteHostRef }) {
  const { snap, remote } = use(ScanContext);
  if (!l.stopPid) return null;
  const viaCli = l.stopPid !== l.pid;
  const probe = remote?.find((h) => h.id === host.id);
  // the other ports this stop takes down on that host, and the local tunnels that lead to any of them
  const siblings = (probe?.listeners ?? []).filter((x) => x.stopPid === l.stopPid);
  const impact: Impact = {
    ports: siblings.map((x) => ({ port: x.port }) as PortRow),
    otherProcesses: 0,
    tunnels: [],
    reverseForwards: [],
  };
  const tunnels = remoteImpact(probe, [...new Set([l.port, ...siblings.map((x) => x.port)])], snap?.ports ?? []);
  return (
    <KillButton
      pid={l.stopPid}
      host={host}
      title={`Kill :${l.port} on ${host.name}`}
      description={
        <KillDescription pid={l.stopPid} viaCli={viaCli} port={l.port} command={viaCli ? undefined : l.command} folder={l.cwd} host={host.name}>
          <ImpactNote impact={impact} port={l.port} localTunnels={tunnels} />
        </KillDescription>
      }
    />
  );
}

const CONTAINER_ACTIONS: Record<ContainerAction, { icon: Icon; filled: boolean; verb: string; done: string; destructive: boolean }> = {
  stop: { icon: SquareIcon, filled: true, verb: "Stop", done: "Stopped", destructive: true },
  restart: { icon: RotateCcwIcon, filled: false, verb: "Restart", done: "Restarted", destructive: false },
  start: { icon: PlayIcon, filled: true, verb: "Start", done: "Started", destructive: false },
};

/**
 * docker start / stop / restart for one container or a group. The title comes from what the action really
 * touches, so a filtered group never claims to act on the whole stack.
 */
export function ContainerActionButton({
  action,
  containers: cs,
  host,
  label,
}: {
  action: ContainerAction;
  containers: ContainerSummary[];
  host?: RemoteHostRef;
  label?: string;
}) {
  const { snap, remote } = use(ScanContext);
  const a = CONTAINER_ACTIONS[action];
  const on = host ? ` on ${host.name}` : "";
  const ids = cs.map((c) => c.id);
  const remotePorts = cs.flatMap((c) => c.ports.map((p) => p.hostPort));
  const impact =
    // a restart comes back, so only a stop leaves anything pointing at nothing
    action !== "stop" ? null : host ? (
      <ImpactNote localTunnels={remoteImpact(remote?.find((h) => h.id === host.id), remotePorts, snap?.ports ?? [])} />
    ) : (
      <ImpactNote impact={snap && { ...containerImpact(snap, ids), ports: [] }} />
    );
  const what = cs.length === 1 ? cs[0].name : `${cs[0].group ?? "containers"} (${cs.length} containers)`;
  const recreate = cs[0].kind === "supabase" ? "supabase start" : cs[0].kind === "compose" ? "docker compose up -d" : "docker start";
  return (
    <ActionButton
      icon={a.icon}
      filled={a.filled}
      label={label}
      title={`${a.verb} ${what}${on}`}
      description={
        <div className="flex flex-col gap-2">
        <p>
          Runs <code className="font-mono">docker {action}</code>
          {host ? ` on ${host.name} over ssh,` : ""} on {cs.length === 1 ? cs[0].name : `${cs.length} containers`}.
          {action === "stop" && (
            <>
              {" "}
              Data volumes are kept; start it again here, or with <code className="font-mono">{recreate}</code>
              {cs[0].workdir ? ` in ${tildify(cs[0].workdir)}` : ""}.
            </>
          )}
          {action === "restart" && " It is briefly unavailable while it restarts."}
        </p>
        {impact}
        </div>
      }
      confirmLabel={a.verb}
      destructive={a.destructive}
      run={() => containerAction(action, ids, host?.id)}
      done={() => `${a.done} ${what}${on}`}
    />
  );
}

/** A container row's actions: Restart and Stop while it's up, Start once it's stopped. */
export function ContainerRowActions({ container: c, host }: { container: ContainerSummary; host?: RemoteHostRef }) {
  return (
    <div className="flex justify-end">
      {isUp(c) ? (
        <>
          <ContainerActionButton action="restart" containers={[c]} host={host} />
          <ContainerActionButton action="stop" containers={[c]} host={host} />
        </>
      ) : (
        <ContainerActionButton action="start" containers={[c]} host={host} />
      )}
    </div>
  );
}

/** A stack's actions: "Start all" for its stopped containers, "Stop all" for its running ones. */
export function ContainerGroupActions({ containers: cs, host }: { containers: ContainerSummary[]; host?: RemoteHostRef }) {
  const up = cs.filter(isUp);
  const down = cs.filter((c) => !isUp(c));
  const all = (n: number) => (cs.length > 1 && n === cs.length ? " all" : "");
  return (
    <>
      {down.length > 0 && <ContainerActionButton action="start" containers={down} host={host} label={`Start${all(down.length)}`} />}
      {up.length > 0 && <ContainerActionButton action="stop" containers={up} host={host} label={`Stop${all(up.length)}`} />}
    </>
  );
}
