import { Loader2Icon } from "lucide-react";
import { useTransition } from "react";
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

type Act = () => Promise<{ error?: string }>;

/**
 * Confirmation for an action that changes something (stop, start, add or remove a host). Stays open and
 * shows a toast when the action returns an error; closes on success. `secondary` adds a second choice.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  secondary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: Act;
  secondary?: { label: string; title?: string; onConfirm: Act };
}) {
  const [pending, startTransition] = useTransition();

  const confirm = (act: Act) =>
    startTransition(async () => {
      const res = await act();
      if (res.error) toast.error(res.error);
      else onOpenChange(false);
    });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {secondary && (
            <Button variant="outline" disabled={pending} onClick={() => confirm(secondary.onConfirm)} title={secondary.title}>
              {secondary.label}
            </Button>
          )}
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={() => confirm(onConfirm)}>
            {pending && <Loader2Icon className="animate-spin" />} {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
