import { BellIcon, BellOffIcon, BookmarkIcon, EllipsisIcon, EyeIcon, EyeOffIcon, PinIcon, PinOffIcon, StickyNoteIcon } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { setPortPref } from "@/lib/api";
import type { PortPref } from "@/lib/collect/types";
import { RefreshContext } from "./stop";

/** A port's own menu: pin it to the top, hide it from the lists, watch it, or leave a note. Saved by port number. */
export function PortMenu({ port, pref }: { port: number; pref: PortPref }) {
  const refresh = use(RefreshContext);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const save = async (change: PortPref, done: string) => {
    const res = await setPortPref(port, change);
    if (res.error) return toast.error(res.error);
    toast.success(done);
    refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={`:${port} options`} aria-label={`:${port} options`} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => save({ pinned: !pref.pinned }, pref.pinned ? `Unpinned :${port}` : `Pinned :${port} to the top`)}>
            {pref.pinned ? <PinOffIcon /> : <PinIcon />} {pref.pinned ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => save({ hidden: !pref.hidden }, pref.hidden ? `:${port} is listed again` : `Hid :${port}; Show hidden brings it back`)}
          >
            {pref.hidden ? <EyeIcon /> : <EyeOffIcon />} {pref.hidden ? "Stop hiding" : "Hide"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              save(
                { watched: !pref.watched },
                pref.watched ? `Stopped watching :${port}` : `Watching :${port}: the menu bar app notifies when it stops or starts`,
              )
            }
          >
            {pref.watched ? <BellOffIcon /> : <BellIcon />} {pref.watched ? "Stop watching" : "Watch"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setNote(pref.note ?? "");
              setNoteOpen(true);
            }}
          >
            <StickyNoteIcon /> {pref.note ? "Edit note" : "Add note"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={noteOpen} onOpenChange={setNoteOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              setNoteOpen(false);
              void save({ note }, note.trim() ? `Saved the note on :${port}` : `Removed the note on :${port}`);
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Note on :{port}</AlertDialogTitle>
              <AlertDialogDescription>Shown under whatever listens on :{port}, now and after it restarts. Empty removes it.</AlertDialogDescription>
            </AlertDialogHeader>
            <Input autoFocus value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. shop API, keep running" />
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit">Save</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A port's note, and who reserved it, under its command. */
export function PortNote({ pref }: { pref: PortPref }) {
  if (!pref.note && !pref.reserved) return null;
  const until = pref.reserved && new Date(pref.reserved.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <>
      {pref.note && (
        <span className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <StickyNoteIcon className="mt-0.5 size-3 shrink-0" />
          <span className="break-words">{pref.note}</span>
        </span>
      )}
      {pref.reserved && (
        <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
          <BookmarkIcon className="mt-0.5 size-3 shrink-0" />
          <span className="break-words">
            Reserved for {pref.reserved.for} until {until}
          </span>
        </span>
      )}
    </>
  );
}
