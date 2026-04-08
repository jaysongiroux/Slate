import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string | null;
  onConfirm: () => Promise<void>;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderPath,
  onConfirm,
}: DeleteFolderDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{folderPath}</strong> and all notes inside it?
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
