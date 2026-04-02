import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface RenameIcsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: { id: string; name: string } | null;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => Promise<void>;
}

export function RenameIcsDialog({
  open,
  onOpenChange,
  subscription,
  value,
  onValueChange,
  onConfirm,
}: RenameIcsDialogProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(420px,calc(100vw-32px))]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => {
            const input = inputRef.current;
            input?.focus();
            input?.select();
          });
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="mb-0">
            <DialogTitle>Rename ICS feed</DialogTitle>
            <DialogDescription>Choose a new display name for this feed.</DialogDescription>
          </DialogHeader>

          <Input
            ref={inputRef}
            variant="bordered"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            aria-label="ICS feed name"
            placeholder={subscription?.name ?? "ICS Feed"}
          />

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!value.trim()}>
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
