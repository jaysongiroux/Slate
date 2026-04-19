import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
  writeStoredSidebarCollapsed,
  writeStoredSidebarWidth,
} from "../lib/sidebarPreferences";

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;
const XS_SIDEBAR_BREAKPOINT = 760;

export function useDesktopShellState() {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(
      window.localStorage,
      DEFAULT_SIDEBAR_WIDTH,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    ),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.innerWidth <= XS_SIDEBAR_BREAKPOINT
      ? true
      : readStoredSidebarCollapsed(window.localStorage),
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarTransitionDisabled, setSidebarTransitionDisabled] = useState(false);

  const resizingRef = useRef(false);
  const sidebarWasFloatingRef = useRef(window.innerWidth <= XS_SIDEBAR_BREAKPOINT);
  const sidebarCollapsedRef = useRef(
    window.innerWidth <= XS_SIDEBAR_BREAKPOINT
      ? true
      : readStoredSidebarCollapsed(window.localStorage),
  );

  useEffect(() => {
    const handleResize = () => {
      const nextWidth = window.innerWidth;
      const wasFloating = sidebarWasFloatingRef.current;
      const willBeFloating = nextWidth <= XS_SIDEBAR_BREAKPOINT;

      if (willBeFloating && !wasFloating && !sidebarCollapsedRef.current) {
        flushSync(() => {
          setSidebarTransitionDisabled(true);
          setSidebarCollapsed(true);
          setViewportWidth(nextWidth);
        });
        sidebarCollapsedRef.current = true;
        resizingRef.current = false;
        document.body.classList.remove("is-resizing");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            setSidebarTransitionDisabled(false);
          });
        });
      } else {
        flushSync(() => {
          setViewportWidth(nextWidth);
        });
      }

      sidebarWasFloatingRef.current = willBeFloating;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeStoredSidebarWidth(window.localStorage, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writeStoredSidebarCollapsed(window.localStorage, sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) {
        return;
      }

      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX)));
    };

    const handlePointerUp = () => {
      resizingRef.current = false;
      document.body.classList.remove("is-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const isFloatingSidebar = viewportWidth <= XS_SIDEBAR_BREAKPOINT;
  const desktopShellColumns =
    !sidebarCollapsed && !isFloatingSidebar
      ? `var(--icon-rail-width) ${sidebarWidth}px 10px minmax(0, 1fr)`
      : `var(--icon-rail-width) 0px 0px minmax(0, 1fr)`;
  const floatingSidebarWidth = Math.min(sidebarWidth, Math.max(280, viewportWidth - 112));
  const mainPanelGridStyle = isFloatingSidebar
    ? ({ gridColumn: "2 / -1", gridRow: "1" } as React.CSSProperties)
    : sidebarCollapsed
      ? ({ gridColumn: "4", gridRow: "1" } as React.CSSProperties)
      : undefined;

  function startResize() {
    resizingRef.current = true;
    document.body.classList.add("is-resizing");
  }

  function toggleSidebar() {
    setSidebarCollapsed((value) => !value);
  }

  return {
    sidebarWidth,
    setSidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    viewportWidth,
    sidebarTransitionDisabled,
    isFloatingSidebar,
    desktopShellColumns,
    floatingSidebarWidth,
    mainPanelGridStyle,
    startResize,
    toggleSidebar,
  };
}
