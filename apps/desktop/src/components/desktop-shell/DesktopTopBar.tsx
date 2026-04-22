import { AlertTriangle, ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { McpStatusBadge } from "./McpStatusBadge";
import { useEffect, useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { formatShortcut } from "../SettingsDialog";
import { useChromeTheme } from "./ChromeThemeProvider";
import { useTopBarErrorStore } from "../../stores/top-bar-error-store";

function WindowControls() {
  return (
    <div className="mr-1 flex items-center overflow-hidden [-webkit-app-region:no-drag]">
      <div className="flex gap-3" aria-hidden="true">
        <span className="size-[13px] rounded-full bg-[#ff5f57]" />
        <span className="size-[13px] rounded-full bg-[#febc2e]" />
        <span className="size-[13px] rounded-full bg-[#28c840]" />
      </div>
    </div>
  );
}

export function DesktopTopBar({
  includeNavigation,
  showSidebarToggle = true,
  sidebarToggleLabel,
  toggleShortcut,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  backShortcut,
  forwardShortcut,
  syncStatus,
}: {
  includeNavigation: boolean;
  showSidebarToggle?: boolean;
  sidebarToggleLabel: string;
  toggleShortcut: string;
  onToggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  backShortcut: string;
  forwardShortcut: string;
  syncStatus: { icon: React.ElementType; label: string; iconClassName?: string };
}) {
  const chromeTheme = useChromeTheme();
  const SyncIcon = syncStatus.icon;
  const [animateTopBarErrorIndicator, setAnimateTopBarErrorIndicator] = useState(false);
  const errors = useTopBarErrorStore((s) => s.errors);
  const topBarErrorIndicatorPaused = useTopBarErrorStore((s) => s.topBarErrorIndicatorPaused);
  const setTopBarErrorIndicatorPaused = useTopBarErrorStore((s) => s.setTopBarErrorIndicatorPaused);
  const activeError = useMemo(
    () => Object.values(errors).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
    [errors],
  );

  useEffect(() => {
    if (!activeError || topBarErrorIndicatorPaused) {
      setAnimateTopBarErrorIndicator(false);
      return;
    }

    let timeoutId: number | null = null;
    const triggerAnimation = () => {
      setAnimateTopBarErrorIndicator(true);
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setAnimateTopBarErrorIndicator(false);
      }, 700);
    };

    triggerAnimation();
    const intervalId = window.setInterval(triggerAnimation, 3800);

    return () => {
      window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activeError, topBarErrorIndicatorPaused]);

  return (
    <header
      className={cn(
        "flex min-h-[48px] items-center gap-4 px-4 backdrop-blur-[36px] backdrop-saturate-[1.65] [-webkit-app-region:drag]",
        chromeTheme.topBarClassName,
      )}
      data-electron-drag-region="true"
    >
      <WindowControls />

      <div
        className={cn(
          "flex items-center gap-0.5 [-webkit-app-region:no-drag]",
          includeNavigation && "mr-2",
        )}
      >
        {showSidebarToggle ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground",
                  includeNavigation && "mr-2",
                )}
                onClick={onToggleSidebar}
                aria-label={sidebarToggleLabel}
              >
                <PanelLeft size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarToggleLabel}{" "}
              <kbd className="ml-1 rounded bg-white/[0.1] px-1 py-0.5 font-mono text-[0.72rem]">
                {formatShortcut(toggleShortcut)}
              </kbd>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {includeNavigation ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  disabled={!canGoBack}
                  onClick={onGoBack}
                  aria-label="Go back"
                >
                  <ArrowLeft size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Go back{" "}
                <kbd className="ml-1 rounded bg-white/[0.1] px-1 py-0.5 font-mono text-[0.72rem]">
                  {formatShortcut(backShortcut)}
                </kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  disabled={!canGoForward}
                  onClick={onGoForward}
                  aria-label="Go forward"
                >
                  <ArrowRight size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Go forward{" "}
                <kbd className="ml-1 rounded bg-white/[0.1] px-1 py-0.5 font-mono text-[0.72rem]">
                  {formatShortcut(forwardShortcut)}
                </kbd>
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2.5 [-webkit-app-region:no-drag]">
          {activeError ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "top-bar-error-indicator inline-flex size-7 items-center justify-center rounded-full border border-transparent bg-transparent text-danger/80 transition-[background-color,color,border-color] hover:border-[rgba(255,156,148,0.14)] hover:bg-[rgba(255,156,148,0.08)] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,156,148,0.3)]",
                  )}
                  aria-label={activeError.title}
                  onMouseEnter={() => setTopBarErrorIndicatorPaused(true)}
                >
                  <span
                    className={cn(
                      "top-bar-error-indicator__icon inline-flex items-center justify-center",
                      animateTopBarErrorIndicator &&
                        "motion-safe:animate-[calendar-toolbar-error-nudge_700ms_cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none",
                    )}
                  >
                    <AlertTriangle size={13} />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-72">
                <div className="text-[0.78rem] font-medium text-danger">{activeError.title}</div>
                <div className="mt-1 text-[0.76rem] leading-snug text-muted">
                  {activeError.message}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : null}
          <McpStatusBadge />
          <div
            className="flex items-center gap-1.5 text-[0.78rem] text-muted"
            title={syncStatus.label}
          >
            <span className={cn("flex items-center", syncStatus.iconClassName)}>
              <SyncIcon size={13} />
            </span>
            <span className="hidden lg:block">{syncStatus.label}</span>
          </div>
        </div>
        <div className="hidden text-[0.72rem] font-normal uppercase tracking-[0.16em] text-faint md:block">
          Slate
        </div>
      </div>
    </header>
  );
}
