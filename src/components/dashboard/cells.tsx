"use client";

/** Table cell building blocks shared by every view. */
import { ArrowRightIcon, CheckIcon, CopyIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Origin, PortRow, ProjectInfo, RemoteListener, RemoteSnapshot } from "@/lib/collect/types";
import { isExposed, localUrl, shortCommand, tildify } from "@/lib/format";
import { type Conflicts, remoteTarget } from "@/lib/grouping";
import { cn } from "@/lib/utils";

/** A port on this Mac that opens in the browser; `tunnel` draws it in the SSH tunnel colour. */
export function PortLink({
  port,
  address,
  tunnel = false,
  title,
  className,
}: {
  port: number;
  address: string;
  tunnel?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <a
      href={localUrl(address, port)}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "group inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums hover:underline",
        tunnel ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400",
        className,
      )}
    >
      :{port}
      <ExternalLinkIcon className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
    </a>
  );
}

/**
 * The "SSH tunnel" column on a remote host: for each of its ports that a local ssh -L forward reaches,
 * "localhost:28080 → :18080 via dev-vps-ports", the local side a link. A dash when nothing is tunnelled.
 */
export function TunnelLinks({ links }: { links: { remotePort: number; tunnel: PortRow }[] }) {
  if (links.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {links.map(({ remotePort, tunnel }) => {
        const via = tunnel.owner.split(" → ")[0];
        return (
          <div key={`${tunnel.pid}-${tunnel.port}`} className="flex flex-wrap items-center gap-x-1.5 text-xs">
            <PortLink
              port={tunnel.port}
              address={tunnel.address}
              tunnel
              title={`Opens localhost:${tunnel.port} on this Mac; ${via} forwards it to :${remotePort} on the host`}
              className="text-xs"
            />
            <ArrowRightIcon className="size-3 text-muted-foreground" />
            <span className="font-mono text-muted-foreground">:{remotePort}</span>
            <span className="text-muted-foreground">via {via}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BindBadge({ address }: { address: string }) {
  const exposed = isExposed(address);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("font-mono text-[11px]", exposed ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
          />
        }
      >
        {exposed ? "exposed" : address}
      </TooltipTrigger>
      <TooltipContent>{exposed ? "Reachable from your LAN / tailnet" : "Only reachable from this machine"}</TooltipContent>
    </Tooltip>
  );
}

/** Clickable local port with its bind address underneath. */
export function PortCell({ port, address }: { port: number; address: string }) {
  return (
    <>
      <PortLink port={port} address={address} />
      <div className="leading-none">
        <BindBadge address={address} />
      </div>
    </>
  );
}

export function CopyPath({ path, className }: { path?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!path || path === "/") return null;
  return (
    <button
      type="button"
      title="Copy path"
      onClick={() => {
        navigator.clipboard.writeText(path);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "group inline-flex min-w-0 items-start gap-1 text-left font-mono text-xs text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span className="break-all">{tildify(path)}</span>
      {copied ? (
        <CheckIcon className="mt-0.5 size-3 shrink-0 text-emerald-500" />
      ) : (
        <CopyIcon className="mt-0.5 size-3 shrink-0 opacity-0 group-hover:opacity-70" />
      )}
    </button>
  );
}

/** Full command line, wrapped (no truncation): the whole point is seeing exactly what's running. */
/** Roughly two lines in the narrowest column that shows a command; longer ones start clamped. */
const LONG_COMMAND = 160;

/** A command line, shortened (no install paths) and clamped to two lines; click shows the full command. */
export function Command({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const full = tildify(text);
  const short = shortCommand(full);
  const base = cn("block font-mono text-xs break-all text-muted-foreground", className);
  if (short === full && full.length <= LONG_COMMAND) return <span className={base}>{full}</span>;
  return (
    <button
      type="button"
      title={expanded ? "Click to show less" : full}
      aria-expanded={expanded}
      onClick={() => setExpanded((e) => !e)}
      className={cn(base, "w-full cursor-pointer text-left", !expanded && "line-clamp-2")}
    >
      {expanded ? full : short}
    </button>
  );
}

/** Under a command: who started it ("from Claude Code · herdr · Ghostty"), and whether that launcher is gone. */
export function OriginLine({ origin }: { origin?: Origin }) {
  if (!origin) return null;
  const from = [origin.agent, origin.app, origin.terminal].filter(Boolean).join(" · ");
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
      {from && <span>from {from}</span>}
      {origin.detached && (
        <Tooltip>
          <TooltipTrigger render={<span className="text-amber-600 dark:text-amber-400" />}>launcher closed</TooltipTrigger>
          <TooltipContent>
            Nothing that started it is still running: no terminal, editor or agent session holds it. Often a forgotten server.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** Small grey monospace value (pid, uptime, memory). */
export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground tabular-nums">{children}</span>;
}

export function ProjectBadges({ project }: { project?: ProjectInfo }) {
  if (!project) return null;
  return (
    <>
      {project.branch && (
        <Badge variant="secondary" className="font-mono text-[11px]">
          {project.branch}
        </Badge>
      )}
      {project.isWorktree && (
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400">
              worktree
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Worktree of {tildify(project.mainRepo ?? "")}</TooltipContent>
        </Tooltip>
      )}
      {project.missing && <Badge variant="destructive">folder deleted</Badge>}
    </>
  );
}

const TECH_COLORS: Record<string, string> = {
  "Next.js": "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
  Vite: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  Supabase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Docker: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "SSH tunnel": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Postgres: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "Local WP": "bg-teal-500/15 text-teal-700 dark:text-teal-300",
};

export function TechBadge({ tech }: { tech?: string }) {
  if (!tech) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium whitespace-nowrap",
        TECH_COLORS[tech] ?? "bg-muted text-muted-foreground",
      )}
    >
      {tech}
    </span>
  );
}

/** On a port that another process also binds: names that other process. */
export function ConflictBadge({ row, conflicts }: { row: PortRow; conflicts: Conflicts }) {
  const others = conflicts.get(row.port)?.filter((o) => o.pid !== row.pid);
  if (!others?.length) return null;
  const name = (o: PortRow) => o.project?.subpath ?? o.project?.name ?? o.processName;
  return (
    <Badge variant="destructive" className="mb-0.5 h-auto whitespace-normal">
      <TriangleAlertIcon /> :{row.port} also bound by {others.map((o) => `${name(o)} (pid ${o.pid})`).join(", ")}
    </Badge>
  );
}

/** What a remote listener is: container, or command + folder. */
export function remoteLabel(l: RemoteListener) {
  if (l.container) return `docker ${l.container}`;
  const where = l.cwd ? tildify(l.cwd) : "";
  return [l.command?.split(" ")[0]?.split("/").pop(), where].filter(Boolean).join(" in ") || l.process || "unknown process";
}

/** Under a local ssh -L port: the service it reaches on the remote host. */
export function RemoteHint({ row, remote }: { row: PortRow; remote?: RemoteSnapshot[] }) {
  if (!row.remotePort || !remote) return null;
  const hit = remoteTarget(row, remote);
  if (!hit) return <span className="text-xs text-muted-foreground">nothing seen on remote :{row.remotePort}</span>;
  return (
    <span className="block text-xs break-all">
      <span className="text-muted-foreground">on {hit.host}: </span>
      <span className="font-mono">{remoteLabel(hit.listener)}</span>
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
