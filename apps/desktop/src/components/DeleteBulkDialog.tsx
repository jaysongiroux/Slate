import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export interface DeleteBulkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: () => Promise<void>;
}

export function DeleteBulkDialog({ open, onOpenChange, count, onConfirm }: DeleteBulkDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {count} items</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <strong>
              {count} item{count !== 1 ? "s" : ""}
            </strong>
            ? This cannot be undone.
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
