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
  checklists: {
    mode: "checklists",
    tone: "green checklist",
    shellStyle: {
      "--chrome-bg": `rgba(30, 42, 34, ${bgOpacity})`,
      "--chrome-border": `rgba(120, 190, 140, ${borderOpacity})`,
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
  linkwarden: {
    mode: "linkwarden",
    tone: "warm amber",
    shellStyle: {
      "--chrome-bg": `rgba(44, 36, 28, ${bgOpacity})`,
      "--chrome-border": `rgba(200, 160, 100, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  "home-assistant": {
    mode: "home-assistant",
    tone: "green home",
    shellStyle: {
      "--chrome-bg": `rgba(28, 44, 38, ${bgOpacity})`,
      "--chrome-border": `rgba(80, 190, 140, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(18, 22, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  jira: {
    mode: "jira",
    tone: "blue jira",
    shellStyle: {
      "--chrome-bg": `rgba(32, 38, 56, ${bgOpacity})`,
      "--chrome-border": `rgba(70, 130, 230, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  forge: {
    mode: "forge",
    tone: "cool slate forge",
    shellStyle: {
      "--chrome-bg": `rgba(30, 40, 52, ${bgOpacity})`,
      "--chrome-border": `rgba(54, 108, 237, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(20, 20, 20, ${mainPanelOpacity})`,
    } as React.CSSProperties,
    railClassName,
    topBarClassName,
    sidebarClassName,
    mainPanelContainerClassName,
  },
  diagrams: {
    mode: "diagrams",
    tone: "cyan diagrams",
    shellStyle: {
      "--chrome-bg": `rgba(28, 40, 50, ${bgOpacity})`,
      "--chrome-border": `rgba(112, 218, 255, ${borderOpacity})`,
      "--chrome-main-panel-bg": `rgba(18, 22, 26, ${mainPanelOpacity})`,
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
