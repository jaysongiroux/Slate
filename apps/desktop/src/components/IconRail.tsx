import { Calendar, MessageSquare, Settings, StickyNote } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export type SidebarMode = "notes" | "chat" | "calendar";

interface IconRailProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  className?: string;
}

const items: { id: SidebarMode; icon: typeof StickyNote; label: string }[] = [
  { id: "notes", icon: StickyNote, label: "Notes" },
  { id: "calendar", icon: Calendar, label: "Calendar" },
  { id: "chat", icon: MessageSquare, label: "AI Chat" },
];

export function IconRail({
  mode,
  onModeChange,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  className,
}: IconRailProps) {
  function handleClick(id: SidebarMode) {
    if (mode === id && !sidebarCollapsed) {
      onToggleSidebar();
    } else {
      onModeChange(id);
    }
  }

  return (
    <nav
      className={cn(
        "flex h-full w-[var(--icon-rail-width)] flex-col items-center gap-1 pb-2 backdrop-blur-[36px] backdrop-saturate-[1.65] border border-white/[0.04]",
        className,
      )}
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
                mode === id
                  ? "bg-white/[0.05] text-foreground"
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

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mt-auto flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-faint transition-colors duration-100 hover:bg-white/[0.06] hover:text-muted"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <Settings size={18} strokeWidth={1.6} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </nav>
  );
}
