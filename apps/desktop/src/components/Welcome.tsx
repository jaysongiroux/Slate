import { FilePlus2, FolderOpen, Keyboard, NotebookPen, Settings } from "lucide-react";
import { Button } from "./ui/button";

export interface WelcomeProps {
  onCreateNote: () => void;
}

export function Welcome({ onCreateNote }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome__icon">
        <NotebookPen size={40} strokeWidth={1.5} />
      </div>
      <h1 className="welcome__title">Welcome to Slate</h1>
      <p className="welcome__subtitle">A calm place for your thoughts, notes, and ideas.</p>
      <div className="welcome__actions">
        <Button variant="primary" onClick={onCreateNote}>
          <FilePlus2 size={16} />
          Create your first note
        </Button>
      </div>
      <div className="welcome__hints">
        <div className="welcome__hint">
          <Keyboard size={14} />
          <span>Type <kbd>/</kbd> for formatting commands</span>
        </div>
        <div className="welcome__hint">
          <FolderOpen size={14} />
          <span>Organize notes into folders from the sidebar</span>
        </div>
        <div className="welcome__hint">
          <Settings size={14} />
          <span>Change your workspace folder in Settings</span>
        </div>
      </div>
    </div>
  );
}
