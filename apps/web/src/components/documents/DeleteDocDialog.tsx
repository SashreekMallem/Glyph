"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export interface DeleteDocDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (v: boolean) => void;
  readonly docId: string;
  readonly docTitle: string;
  readonly onDeleted?: () => void;
}

export function DeleteDocDialog({
  open,
  onOpenChange,
  docId,
  docTitle,
  onDeleted,
}: DeleteDocDialogProps) {
  const utils = trpc.useUtils();
  const del = trpc.documents.delete.useMutation({
    onSuccess: async () => {
      await utils.documents.list.invalidate();
      onOpenChange(false);
      if (onDeleted) onDeleted();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            This will permanently delete
            <span className="font-medium text-neutral-900"> {docTitle}</span>.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => del.mutate({ id: docId })}
          >
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
