import { useEffect, useRef } from "react";

export function useDebouncedSave<T>(value: T, delayMs: number, onSave: (v: T) => void) {
  const firstRun = useRef(true);
  const latest = useRef(onSave);
  latest.current = onSave;

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const h = setTimeout(() => latest.current(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
}
