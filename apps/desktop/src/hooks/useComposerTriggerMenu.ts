import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { RefObject } from "react";
import {
  filterTriggerMenuItems,
  getActiveTriggerState,
  type ActiveTriggerState,
  type TriggerMenuItemBase,
} from "../lib/composerTriggerMenu";

export type ComposerTriggerMenuItem = TriggerMenuItemBase & {
  /** Spliced in at the cursor after removing the trigger segment; leading space often desired before links */
  insertText?: string;
  /** Runs after value update; omit for insert-only picks (e.g. @ note) */
  execute?: () => void | Promise<void>;
};

/** Max rows shown when the trigger query is empty (large @ lists). */
const MENU_CAP_EMPTY_QUERY = 50;
/** Max rows after filtering when the user typed a query. */
const MENU_CAP_WITH_QUERY = 200;

export type ComposerTriggerMenuConfig = {
  trigger: string;
  items: ComposerTriggerMenuItem[];
  emptyHint?: string;
};

export function useComposerTriggerMenu(options: {
  value: string;
  setValue: (next: string) => void;
  configs: ComposerTriggerMenuConfig[];
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  disabled?: boolean;
}) {
  const { value, setValue, configs, inputRef, disabled } = options;

  const [cursorPos, setCursorPos] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const triggers = useMemo(() => configs.map((c) => c.trigger), [configs]);

  const activeState = useMemo((): ActiveTriggerState | null => {
    if (disabled) return null;
    return getActiveTriggerState(value, cursorPos, triggers);
  }, [value, cursorPos, triggers, disabled]);

  const definition = useMemo(() => {
    if (!activeState) return null;
    return configs.find((c) => c.trigger === activeState.trigger) ?? null;
  }, [activeState, configs]);

  const filteredItems = useMemo(() => {
    if (!definition) return [];
    const q = (activeState?.query ?? "").trim();
    let items = filterTriggerMenuItems(definition.items, activeState?.query ?? "");
    if (q === "") {
      items = items.slice(0, MENU_CAP_EMPTY_QUERY);
    } else {
      items = items.slice(0, MENU_CAP_WITH_QUERY);
    }
    return items;
  }, [definition, activeState?.query]);

  const emptyHint =
    definition && filteredItems.length === 0 ? definition.emptyHint : null;

  const menuVisible = Boolean(
    activeState && definition && (filteredItems.length > 0 || emptyHint),
  );

  const maxIdx = Math.max(0, filteredItems.length - 1);
  const safeIndex = Math.min(selectedIndex, maxIdx);

  useEffect(() => {
    setSelectedIndex(0);
  }, [
    activeState?.replaceFrom,
    activeState?.replaceTo,
    activeState?.query,
    definition?.trigger,
  ]);

  const syncSelectionFromEvent = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement) => {
      setCursorPos(el.selectionStart ?? 0);
    },
    [],
  );

  const stripRange = useCallback(
    (replaceFrom: number, replaceTo: number) => {
      const next = value.slice(0, replaceFrom) + value.slice(replaceTo);
      setValue(next);
      queueMicrotask(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(replaceFrom, replaceFrom);
        setCursorPos(replaceFrom);
      });
    },
    [value, setValue, inputRef],
  );

  const stripInsertAndRun = useCallback(
    async (
      replaceFrom: number,
      replaceTo: number,
      insertText: string | undefined,
      fn?: () => void | Promise<void>,
    ) => {
      const insert = insertText ?? "";
      const next = value.slice(0, replaceFrom) + insert + value.slice(replaceTo);
      setValue(next);
      await Promise.resolve(fn?.());
      const cursor = replaceFrom + insert.length;
      queueMicrotask(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(cursor, cursor);
        setCursorPos(cursor);
      });
    },
    [value, setValue, inputRef],
  );

  const pickItem = useCallback(
    (index: number) => {
      if (!activeState || !definition) return;
      const item = filteredItems[index];
      if (!item) return;
      void stripInsertAndRun(
        activeState.replaceFrom,
        activeState.replaceTo,
        item.insertText,
        item.execute,
      );
    },
    [activeState, definition, filteredItems, stripInsertAndRun],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
      if (!menuVisible || !activeState) return false;

      if (e.key === "Escape") {
        e.preventDefault();
        stripRange(activeState.replaceFrom, activeState.replaceTo);
        return true;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, maxIdx));
        return true;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return true;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (filteredItems.length > 0) {
          pickItem(safeIndex);
        } else {
          stripRange(activeState.replaceFrom, activeState.replaceTo);
        }
        return true;
      }

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (filteredItems.length > 0) {
          pickItem(safeIndex);
        } else {
          stripRange(activeState.replaceFrom, activeState.replaceTo);
        }
        return true;
      }

      return false;
    },
    [
      menuVisible,
      activeState,
      maxIdx,
      filteredItems.length,
      pickItem,
      safeIndex,
      stripRange,
    ],
  );

  const onMenuItemMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
    },
    [],
  );

  const highlightItem = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  return {
    syncSelectionFromEvent,
    menuVisible,
    filteredItems,
    emptyHint,
    selectedIndex: safeIndex,
    onKeyDown,
    pickItem,
    onMenuItemMouseDown,
    highlightItem,
  };
}
