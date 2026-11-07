"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addRemoteHost } from "@/lib/api";
import type { RemoteSnapshot, Snapshot } from "@/lib/collect/types";
import { SSH_TARGET_RE } from "@/lib/ssh-target";
import { ConfirmDialog } from "./confirm";

/** Hosts worth adding: what you're already ssh'd into, plus online tailnet peers. */
function suggestions(snap: Snapshot | undefined, hosts: RemoteSnapshot[]) {
  const existing = hosts.flatMap((h) => [h.sshTarget, h.resolvedHost]);
  const s = new Set<string>();
  for (const c of snap?.ssh ?? []) if (c.role !== "multiplexed" && !existing.includes(c.hostname)) s.add(c.target);
  for (const p of snap?.tailscale?.peers ?? []) if (p.online && p.os === "linux") s.add(p.name);
  return [...s].filter((t) => SSH_TARGET_RE.test(t) && !existing.includes(t));
}

/** The side drawer for adding a remote host; adding still asks for confirmation. */
export function AddHostSheet({
  open,
  onOpenChange,
  snap,
  hosts,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snap?: Snapshot;
  hosts?: RemoteSnapshot[];
  /** re-probe the hosts after one is added */
  onAdded: () => Promise<void>;
}) {
  const [target, setTarget] = useState("");
  // what the confirmation is about; kept after closing so the dialog text doesn't blank mid-animation
  const [toAdd, setToAdd] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const sugg = suggestions(snap, hosts ?? []);

  const askAdd = (t: string) => {
    setToAdd(t.trim());
    setConfirmOpen(true);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a remote host</SheetTitle>
            <SheetDescription>
              Probed over SSH every 30s with key auth (BatchMode): listening ports with their folders, docker containers, and
              the machine's load, memory and disk. Containers can be stopped (with confirmation); nothing else is changed on
              the host.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (target.trim()) askAdd(target);
              }}
            >
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="ssh alias, or user@host"
                aria-label="ssh alias from ~/.ssh/config, or user@host"
                className="font-mono"
                autoFocus
              />
              <Button type="submit" disabled={!target.trim()}>
                <PlusIcon data-icon="inline-start" /> Add
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Use an alias from <code className="font-mono">~/.ssh/config</code> or <code className="font-mono">user@host</code>; the
              key must already be set up.
            </p>
            {sugg.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Seen on this machine</span>
                <div className="flex flex-wrap gap-1.5">
                  {sugg.map((s) => (
                    <Button key={s} variant="secondary" size="xs" onClick={() => askAdd(s)}>
                      <PlusIcon data-icon="inline-start" /> {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Add ${toAdd}?`}
        description={
          <p>
            Triage will connect to <code className="font-mono">{toAdd}</code> over SSH every 30 seconds and read its listening ports
            and docker containers. Nothing is changed on the host.
          </p>
        }
        confirmLabel="Add host"
        onConfirm={async () => {
          const res = await addRemoteHost(toAdd);
          if (!res.error) {
            setTarget("");
            onOpenChange(false);
            await onAdded();
          }
          return res;
        }}
      />
    </>
  );
}
