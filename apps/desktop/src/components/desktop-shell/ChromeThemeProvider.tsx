import { createContext, useContext } from "react";
import type { SidebarMode } from "../IconRail";

type ChromeTheme = {
  mode: SidebarMode;
  tone: string;
  shellStyle: React.CSSProperties;
  railClassName: string;
  topBarClassName: string;
  sidebarClassName: string;
  mainPanelContainerClassName: string;
};

const bgOpacity = "0.58";
const borderOpacity = "0.38";
const mainPanelOpacity = "0.90";
const railClassName = "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out";
const topBarClassName = "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out";
const sidebarClassName = "bg-[var(--chrome-bg)] transition-colors duration-300 ease-out";
const mainPanelContainerClassName =
  "bg-[var(--chrome-main-panel-bg)] transition-colors duration-300 ease-out";

const THEME_BY_MODE: Record<SidebarMode, ChromeTheme> = {
  notes: {
    mode: "notes",
    tone: "monochrome gray",
    shellStyle: {
      "--chrome-bg": `rgba(34, 34, 36, ${bgOpacity})`,
      "--chrome-border": `rgba(255, 255, 255, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  chat: {
    mode: "chat",
    tone: "violet",
    shellStyle: {
      "--chrome-bg": `rgba(46, 36, 72, ${bgOpacity})`,
      "--chrome-border": `rgba(142, 118, 230, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  calendar: {
    mode: "calendar",
    tone: "bluer violet",
    shellStyle: {
      "--chrome-bg": `rgba(34, 42, 82, ${bgOpacity})`,
      "--chrome-border": `rgba(118, 134, 236, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  graph: {
    mode: "graph",
    tone: "teal graph",
    shellStyle: {
      "--chrome-bg": `rgba(28, 44, 46, ${bgOpacity})`,
      "--chrome-border": `rgba(120, 200, 190, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(18, 22, 22, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
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
