import {
  Calendar,
  CheckSquare,
  GitBranch,
  HousePlug,
  Link,
  MessageSquare,
  Settings,
  SquareKanban,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

export type SidebarMode =
  | "notes"
  | "chat"
  | "calendar"
  | "graph"
  | "checklists"
  | "linkwarden"
  | "home-assistant"
  | "jira";

interface IconRailProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  /** When true, show the note similarity graph entry (requires auth + backend). */
  showNoteGraph?: boolean;
  showChecklists?: boolean;
  showLinkwarden?: boolean;
  showHomeAssistant?: boolean;
  showJira?: boolean;
  loading?: boolean;
  className?: string;
}

export function IconRail({
  mode,
  onModeChange,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  showNoteGraph = false,
  showChecklists = false,
  showLinkwarden = false,
  showHomeAssistant = false,
  showJira = false,
  loading = false,
  className,
}: IconRailProps) {
  const items = useMemo(() => {
    const base: { id: SidebarMode; icon: LucideIcon; label: string }[] = [
      { id: "notes", icon: StickyNote, label: "Notes" },
      { id: "calendar", icon: Calendar, label: "Calendar" },
      { id: "chat", icon: MessageSquare, label: "AI Chat" },
      ...(showNoteGraph ? [{ id: "graph" as const, icon: GitBranch, label: "Note graph" }] : []),
      ...(showChecklists
        ? [{ id: "checklists" as const, icon: CheckSquare, label: "Checklists" }]
        : []),
      ...(showLinkwarden ? [{ id: "linkwarden" as const, icon: Link, label: "LinkWarden" }] : []),
      ...(showHomeAssistant
        ? [{ id: "home-assistant" as const, icon: HousePlug, label: "Home Assistant" }]
        : []),
      ...(showJira ? [{ id: "jira" as const, icon: SquareKanban, label: "Jira" }] : []),
    ];
    return base;
  }, [showNoteGraph, showChecklists, showLinkwarden, showHomeAssistant, showJira]);

  function handleClick(id: SidebarMode) {
    if (mode === id) {
      onToggleSidebar();
    } else {
      onModeChange(id);
      if (sidebarCollapsed) onToggleSidebar();
    }
  }

  return (
    <nav
      className={cn(
        "flex h-full w-[var(--icon-rail-width)] flex-col items-center gap-1 pb-2 backdrop-blur-[36px] backdrop-saturate-[1.65]",
        className,
      )}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      aria-label="Navigation"
    >
      <AnimatePresence>
        {!loading &&
          items.map(({ id, icon: Icon, label }, index) => (
            <motion.div
              key={id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, delay: index * 0.03, ease: "easeOut" }}
            >
              <Tooltip>
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
            </motion.div>
          ))}
      </AnimatePresence>

      <AnimatePresence>
        {!loading && (
          <motion.div
            className="mt-auto"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: items.length * 0.03, ease: "easeOut" }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-faint transition-colors duration-100 hover:bg-white/[0.06] hover:text-muted"
                  onClick={onOpenSettings}
                  aria-label="Settings"
                >
                  <Settings size={18} strokeWidth={1.6} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
