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
  title?: string;
  description?: string;
  confirmLabel?: string;
  validationMessage?: string | null;
  disableConfirm?: boolean;
  /** When true (e.g. new folder), the name field is focused with the full value selected. */
  selectAllOnOpen?: boolean;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  onConfirm,
  title = "Rename folder",
  description = "Enter a new name for this folder.",
  confirmLabel = "Rename",
  validationMessage = null,
  disableConfirm = false,
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 px-0.5" onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            variant="bordered"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            invalid={Boolean(validationMessage)}
            autoFocus={!selectAllOnOpen}
          />
          {validationMessage ? (
            <p className="m-0 text-[0.78rem] leading-snug text-danger">{validationMessage}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="dialog-secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="dialog-primary" type="submit" disabled={disableConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
