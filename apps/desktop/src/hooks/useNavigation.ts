import { useCallback, useRef } from "react";
import { useNavigationStore, type NavEntry } from "../stores/navigation-store";

export function useNavigation(applyEntry: (entry: NavEntry) => void) {
  const applyRef = useRef(applyEntry);
  applyRef.current = applyEntry;

  const push = useNavigationStore((s) => s.push);
  const storeGoBack = useNavigationStore((s) => s.goBack);
  const storeGoForward = useNavigationStore((s) => s.goForward);
  const canGoBack = useNavigationStore((s) => s.currentIndex > 0);
  const canGoForward = useNavigationStore((s) => s.currentIndex < s.entries.length - 1);

  const goBack = useCallback(() => {
    const entry = storeGoBack();
    if (entry) applyRef.current(entry);
  }, [storeGoBack]);

  const goForward = useCallback(() => {
    const entry = storeGoForward();
    if (entry) applyRef.current(entry);
  }, [storeGoForward]);

  return { canGoBack, canGoForward, push, goBack, goForward };
}
