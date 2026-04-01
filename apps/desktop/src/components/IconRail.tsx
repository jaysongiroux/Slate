import { Calendar, MessageSquare, StickyNote } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export type SidebarMode = "notes" | "chat" | "calendar";

interface IconRailProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const items: { id: SidebarMode; icon: typeof StickyNote; label: string }[] = [
  { id: "notes", icon: StickyNote, label: "Notes" },
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "chat", icon: MessageSquare, label: "AI Chat" },
];

export function IconRail({ mode, onModeChange, sidebarCollapsed, onToggleSidebar }: IconRailProps) {
  function handleClick(id: SidebarMode) {
    if (mode === id && !sidebarCollapsed) {
      onToggleSidebar();
    } else {
      onModeChange(id);
    }
  }

  return (
    <nav
      className="flex h-full w-[var(--icon-rail-width)] flex-col items-center gap-1 border-r border-white/[0.04] bg-icon-rail pt-[48px] pb-2"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Navigation"
    >
      {items.map(({ id, icon: Icon, label }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 transition-colors duration-100",
                mode === id && !sidebarCollapsed
                  ? "bg-white/[0.10] text-foreground"
                  : "text-faint hover:bg-white/[0.06] hover:text-muted",
              )}
              onClick={() => handleClick(id)}
              aria-label={label}
              aria-pressed={mode === id && !sidebarCollapsed}
            >
              <Icon size={18} strokeWidth={1.6} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}
