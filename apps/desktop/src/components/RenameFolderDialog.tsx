import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: { path: string; name: string } | null;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => Promise<void>;
  /** When true (e.g. new folder), the name field is focused with the full value selected. */
  selectAllOnOpen?: boolean;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folder,
  value,
  onValueChange,
  onConfirm,
  selectAllOnOpen = false,
}: RenameFolderDialogProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          if (!selectAllOnOpen) return;
          event.preventDefault();
          requestAnimationFrame(() => {
            const el = inputRef.current;
            el?.focus();
            el?.select();
          });
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>Enter a new name for this folder.</DialogDescription>
        </DialogHeader>
        <form className="settings-panel" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="ui-input ui-input--bordered"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            autoFocus={!selectAllOnOpen}
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
