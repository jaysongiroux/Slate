import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface CreateDiagramDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => Promise<void>;
}

export function CreateDiagramDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  onConfirm,
}: CreateDiagramDialogProps) {
  const trimmed = value.trim();
  const disableConfirm = trimmed.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disableConfirm) return;
    await onConfirm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New diagram</DialogTitle>
          <DialogDescription>Give your diagram a name.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 px-0.5" onSubmit={handleSubmit}>
          <Input
            variant="bordered"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="Diagram name"
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="dialog-secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="dialog-primary" type="submit" disabled={disableConfirm}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
