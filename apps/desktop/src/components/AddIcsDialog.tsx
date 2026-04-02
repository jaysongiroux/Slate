import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AddIcsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (url: string, name: string) => Promise<void> | void;
}

export function AddIcsDialog({ open, onOpenChange, onConfirm }: AddIcsDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setName("");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onConfirm(url.trim(), name.trim() || "ICS Feed");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="mb-0">
            <DialogTitle>Add ICS Feed</DialogTitle>
            <DialogDescription>
              Subscribe to a read-only ICS calendar feed. Events are fetched fresh from the URL when
              you open the calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted" htmlFor="ics-url">
              Feed URL
            </label>
            <Input
              id="ics-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/calendar.ics"
              autoFocus
              variant="bordered"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8rem] text-muted" htmlFor="ics-name">
              Display name
            </label>
            <Input
              id="ics-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ICS Feed"
              variant="bordered"
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!url.trim() || submitting}>
              {submitting ? "Adding…" : "Add feed"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
