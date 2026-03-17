import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: { path: string; name: string } | null;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => Promise<void>;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folder,
  value,
  onValueChange,
  onConfirm,
}: RenameFolderDialogProps) {
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>Enter a new name for this folder.</DialogDescription>
        </DialogHeader>
        <form className="settings-panel" onSubmit={handleSubmit}>
          <input
            className="ui-input ui-input--bordered"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            autoFocus
          />
          <div className="dialog-actions">
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
