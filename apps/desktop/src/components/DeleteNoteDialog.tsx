import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { basename } from "../lib/noteTree";

export interface DeleteNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notePath: string | null;
  onConfirm: () => Promise<void>;
}

export function DeleteNoteDialog({
  open,
  onOpenChange,
  notePath,
  onConfirm,
}: DeleteNoteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete note</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{notePath ? basename(notePath) : ""}</strong>?
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="dialog-secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dialog-danger" onClick={() => void onConfirm()}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
