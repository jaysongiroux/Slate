import { GripVertical } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconRail, type SidebarMode } from "../IconRail";
import { ChromeThemeProvider, useChromeTheme } from "./ChromeThemeProvider";
import { DesktopTopBar } from "./DesktopTopBar";

function DesktopShellBody({
  mode,
  desktopShellColumns,
  isFloatingSidebar,
  sidebarCollapsed,
  sidebarTransitionDisabled,
  floatingSidebarWidth,
  mainPanelGridStyle,
  onDismissFloatingSidebar,
  onModeChange,
  onToggleSidebar,
  onOpenSettings,
  onStartResize,
  sidebarContent,
  mainContent,
  topBarProps,
  children,
}: {
  mode: SidebarMode;
  desktopShellColumns: string;
  isFloatingSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarTransitionDisabled: boolean;
  floatingSidebarWidth: number;
  mainPanelGridStyle?: React.CSSProperties;
  onDismissFloatingSidebar: () => void;
  onModeChange: (mode: SidebarMode) => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onStartResize: () => void;
  sidebarContent: React.ReactNode;
  mainContent: React.ReactNode;
  topBarProps: React.ComponentProps<typeof DesktopTopBar>;
  children?: React.ReactNode;
}) {
  const chromeTheme = useChromeTheme();

  return (
    <div
      className={cn(
        "desktop-shell relative box-border flex h-screen flex-col overflow-hidden border border-white/[0.04]",
      )}
      style={chromeTheme.shellStyle}
    >
      <DesktopTopBar {...topBarProps} />
      <div
        className="desktop-shell__body relative min-h-0 flex-1"
        style={{ "--desktop-shell-columns": desktopShellColumns } as React.CSSProperties}
      >
        {isFloatingSidebar && !sidebarCollapsed ? (
          <div
            className="pointer-events-auto absolute inset-y-0 right-0 z-30 bg-black/[0.18] opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none"
            style={{ left: "var(--icon-rail-width)" } as React.CSSProperties}
            onClick={onDismissFloatingSidebar}
            aria-hidden="true"
          />
        ) : null}
        <IconRail
          mode={mode}
          onModeChange={onModeChange}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onOpenSettings={onOpenSettings}
          className={chromeTheme.railClassName}
        />
        <aside
          className={cn(
            "sidebar-shell",
            chromeTheme.sidebarClassName,
            isFloatingSidebar
              ? [
                  "sidebar-shell--floating absolute right-auto bottom-2 z-40 overflow-hidden rounded-[4px] border border-white/[0.06] shadow-[0_24px_72px_rgba(0,0,0,0.44)]",
                  "transition-[transform,opacity,box-shadow] duration-220 ease-out motion-reduce:transition-none",
                ]
              : "sidebar-shell--docked",
            sidebarCollapsed && "pointer-events-none overflow-hidden",
            sidebarTransitionDisabled && "transition-none!",
          )}
          data-sidebar-mode={mode}
          data-sidebar-presentation={isFloatingSidebar ? "floating" : "docked"}
          aria-hidden={sidebarCollapsed}
          style={
            isFloatingSidebar
              ? ({
                  width: floatingSidebarWidth,
                  maxWidth: "calc(100% - var(--icon-rail-width) - 16px)",
                  maxHeight: "calc(100% - 16px)",
                  top: 8,
                  left: "calc(var(--icon-rail-width) + 8px)",
                  transform: sidebarCollapsed ? "translateX(calc(-100% - 16px))" : "translateX(0)",
                  opacity: sidebarCollapsed ? 0 : 1,
                } as React.CSSProperties)
              : undefined
          }
        >
          {sidebarContent}
        </aside>

        {!sidebarCollapsed && !isFloatingSidebar ? (
          <div
            className={cn(
              "sidebar-resizer transition-colors duration-300 ease-out",
              chromeTheme.sidebarClassName,
            )}
            onPointerDown={onStartResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          >
            <GripVertical size={14} />
          </div>
        ) : null}

        <main
          className="relative z-0 flex min-h-0 min-w-0 flex-col bg-panel rounded-md"
          style={mainPanelGridStyle}
        >
          {mainContent}
        </main>
      </div>
      {children}
    </div>
  );
}

export function DesktopShell({
  mode,
  ...props
}: Omit<React.ComponentProps<typeof DesktopShellBody>, "mode"> & { mode: SidebarMode }) {
  return (
    <ChromeThemeProvider mode={mode}>
      <DesktopShellBody mode={mode} {...props} />
    </ChromeThemeProvider>
  );
}
