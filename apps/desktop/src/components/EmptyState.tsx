import { cn } from "../lib/utils";

export function EmptyState() {
  return (
    <div className={cn("grid min-h-full place-content-center p-10 text-center")}>
      <div className="text-xl font-semibold">No note selected</div>
      <div className="mt-2 text-muted">Choose a note from the sidebar, or create a new one.</div>
    </div>
  );
}
