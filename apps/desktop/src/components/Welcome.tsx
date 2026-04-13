import { FilePlus2, FolderOpen, Keyboard, NotebookPen, Settings } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export interface WelcomeProps {
  onCreateNote: () => void;
}

export function Welcome({ onCreateNote }: WelcomeProps) {
  return (
    <div
      className={cn("flex min-h-full flex-col items-center justify-center gap-0 p-10 text-center")}
    >
      <div className="mb-5 text-faint">
        <NotebookPen size={40} strokeWidth={1.5} />
      </div>
      <h1 className="m-0 text-2xl font-semibold tracking-tight">Welcome to Slate</h1>
      <p className="mt-2 max-w-[300px] text-[0.95rem] text-muted">
        A calm place for your thoughts, notes, and ideas.
      </p>
      <div className="mt-7">
        <Button variant="primary" onClick={onCreateNote}>
          <FilePlus2 size={16} />
          Create your first note
        </Button>
      </div>
      <div className="mt-10 flex flex-col gap-3">
        <div className="flex items-center gap-2.5 text-[0.82rem] text-faint">
          <Keyboard size={14} />
          <span>
            Type{" "}
            <kbd className="inline-block rounded px-1.5 py-px font-inherit text-[0.82rem] bg-white/[0.08]">
              /
            </kbd>{" "}
            for formatting commands
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-[0.82rem] text-faint">
          <FolderOpen size={14} />
          <span>Organize notes into folders from the sidebar</span>
        </div>
        <div className="flex items-center gap-2.5 text-[0.82rem] text-faint">
          <Settings size={14} />
          <span>Change your workspace folder in Settings</span>
        </div>
      </div>
    </div>
  );
}
