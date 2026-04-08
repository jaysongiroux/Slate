import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { formatShortcut } from "../SettingsDialog";
import { useChromeTheme } from "./ChromeThemeProvider";

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
  sidebarToggleLabel,
  toggleShortcut,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  syncStatus,
}: {
  includeNavigation: boolean;
  sidebarToggleLabel: string;
  toggleShortcut: string;
  onToggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  syncStatus: { icon: React.ElementType; label: string; iconClassName?: string };
}) {
  const chromeTheme = useChromeTheme();
  const SyncIcon = syncStatus.icon;

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
        {includeNavigation ? (
          <>
            <button
              type="button"
              className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
              disabled={!canGoBack}
              onClick={onGoBack}
              title="Go back"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-30"
              disabled={!canGoForward}
              onClick={onGoForward}
              title="Go forward"
            >
              <ArrowRight size={14} />
            </button>
          </>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2.5">
        <div className="hidden text-[0.72rem] font-normal uppercase tracking-[0.16em] text-faint md:block">
          Slate
        </div>
        <div className="flex items-center gap-2.5 [-webkit-app-region:no-drag]">
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
      </div>
    </header>
  );
}
