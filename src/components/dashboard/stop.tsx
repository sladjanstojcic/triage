"use client";

import { Loader2Icon, PlayIcon, RotateCcwIcon, SquareIcon, UnplugIcon, XIcon } from "lucide-react";
import { createContext, use, useState, useTransition } from "react";
import { toast } from "sonner";
import { type ContainerAction, containerAction, stopProcess, stopRemoteProcess } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ContainerSummary, LocalProcess, PortRow, RemoteListener } from "@/lib/collect/types";
import { tildify } from "@/lib/format";
import { isUp } from "@/lib/grouping";
import { cn } from "@/lib/utils";

/** Lets any action button trigger an immediate re-scan after it acts. */
export const RefreshContext = createContext<() => void>(() => {});

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
  const [pending, startTransition] = useTransition();

  const act = (forced: boolean) =>
    startTransition(async () => {
      const res = await run(forced);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(done(forced));
      setOpen(false);
      // give the process or container a moment to change state before re-scanning
      setTimeout(refresh, 600);
    });

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
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            {force && (
              <Button variant="outline" disabled={pending} onClick={() => act(true)} title="SIGKILL: no cleanup">
                Force kill
              </Button>
            )}
            <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={() => act(false)}>
              {pending && <Loader2Icon className="animate-spin" />} {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function KillDescription({ pid, viaCli, port, command, folder, host }: {
  pid: number;
  viaCli: boolean;
  port: number;
  command?: string;
  folder?: string;
  host?: string;
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
        target={row.owner.split(" → ")[0]}
        note={`Every forward on this connection closes, not just :${row.port}.`}
      />
    );
  }
  const viaCli = row.stopPid !== row.pid;
  return (
    <KillButton
      pid={row.stopPid}
      title={`Kill :${row.port}${row.project ? ` (${row.project.name})` : ""}`}
      description={
        <KillDescription
          pid={row.stopPid}
          viaCli={viaCli}
          port={row.port}
          command={viaCli ? procs.get(row.pid)?.parentCommand : row.owner}
          folder={row.folder}
        />
      }
    />
  );
}

/** Kill control for a port on a remote host; the server re-checks the pid against a fresh probe. */
export function RemotePortStop({ listener: l, host }: { listener: RemoteListener; host: RemoteHostRef }) {
  if (!l.stopPid) return null;
  const viaCli = l.stopPid !== l.pid;
  return (
    <KillButton
      pid={l.stopPid}
      host={host}
      title={`Kill :${l.port} on ${host.name}`}
      description={<KillDescription pid={l.stopPid} viaCli={viaCli} port={l.port} command={viaCli ? undefined : l.command} folder={l.cwd} host={host.name} />}
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
  const a = CONTAINER_ACTIONS[action];
  const on = host ? ` on ${host.name}` : "";
  const what = cs.length === 1 ? cs[0].name : `${cs[0].group ?? "containers"} (${cs.length} containers)`;
  const recreate = cs[0].kind === "supabase" ? "supabase start" : cs[0].kind === "compose" ? "docker compose up -d" : "docker start";
  return (
    <ActionButton
      icon={a.icon}
      filled={a.filled}
      label={label}
      title={`${a.verb} ${what}${on}`}
      description={
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
      }
      confirmLabel={a.verb}
      destructive={a.destructive}
      run={() => containerAction(action, cs.map((c) => c.id), host?.id)}
      done={() => `${a.done} ${what}${on}`}
    />
  );
}

/** A container row's actions: Restart and Stop while it's up, Start once it's stopped. */
export function ContainerRowActions({ container: c, host }: { container: ContainerSummary; host?: RemoteHostRef }) {
  return isUp(c) ? (
    <div className="flex justify-end">
      <ContainerActionButton action="restart" containers={[c]} host={host} />
      <ContainerActionButton action="stop" containers={[c]} host={host} />
    </div>
  ) : (
    <div className="flex justify-end">
      <ContainerActionButton action="start" containers={[c]} host={host} />
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
