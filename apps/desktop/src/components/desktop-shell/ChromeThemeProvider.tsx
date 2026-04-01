import { createContext, useContext } from "react";
import type { SidebarMode } from "../IconRail";

type ChromeTheme = {
  mode: SidebarMode;
  tone: string;
  shellStyle: React.CSSProperties;
  railClassName: string;
  topBarClassName: string;
  sidebarClassName: string;
};

const THEME_BY_MODE: Record<SidebarMode, ChromeTheme> = {
  notes: {
    mode: "notes",
    tone: "monochrome gray",
    shellStyle: {
      "--chrome-bg": "rgba(34, 34, 36, 0.45)",
      "--chrome-border": "rgba(255, 255, 255, 0.04)",
    } as React.CSSProperties,
    railClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    topBarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    sidebarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
  },
  chat: {
    mode: "chat",
    tone: "violet",
    shellStyle: {
      "--chrome-bg": "rgba(46, 36, 72, 0.45)",
      "--chrome-border": "rgba(142, 118, 230, 0.16)",
    } as React.CSSProperties,
    railClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    topBarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    sidebarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
  },
  calendar: {
    mode: "calendar",
    tone: "bluer violet",
    shellStyle: {
      "--chrome-bg": "rgba(34, 42, 82, 0.45)",
      "--chrome-border": "rgba(118, 134, 236, 0.18)",
    } as React.CSSProperties,
    railClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    topBarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
    sidebarClassName: "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out",
  },
};

const ChromeThemeContext = createContext<ChromeTheme>(THEME_BY_MODE.notes);

export function ChromeThemeProvider({
  mode,
  children,
}: {
  mode: SidebarMode;
  children: React.ReactNode;
}) {
  return (
    <ChromeThemeContext.Provider value={THEME_BY_MODE[mode]}>
      {children}
    </ChromeThemeContext.Provider>
  );
}

export function useChromeTheme() {
  return useContext(ChromeThemeContext);
}
