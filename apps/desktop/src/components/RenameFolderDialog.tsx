import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => Promise<void>;
  /** When true (e.g. new folder), the name field is focused with the full value selected. */
  selectAllOnOpen?: boolean;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
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
        <form className="grid gap-4 px-0.5" onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            variant="bordered"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            autoFocus={!selectAllOnOpen}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
