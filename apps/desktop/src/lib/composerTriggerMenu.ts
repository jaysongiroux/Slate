/**
 * Generic "type a trigger character then a token" menus for chat-style inputs (/commands, @mentions, …).
 */

export interface TriggerMenuItemBase {
  id: string;
  label: string;
  description?: string;
  /** Extra substrings used when filtering (in addition to label) */
  keywords?: string[];
}

export interface TriggerMenuDefinition<T extends TriggerMenuItemBase = TriggerMenuItemBase> {
  trigger: string;
  items: T[];
  /** When `items` is empty or the query filters everything out */
  emptyHint?: string;
}

export interface ActiveTriggerState {
  trigger: string;
  query: string;
  replaceFrom: number;
  replaceTo: number;
}

/**
 * Finds the active trigger segment immediately before the cursor: `trigger` + `query`,
 * where `query` has no whitespace (same line).
 * Trigger must be at string start or after whitespace.
 */
export function getActiveTriggerState(
  value: string,
  cursorPos: number,
  triggers: string[],
): ActiveTriggerState | null {
  const before = value.slice(0, cursorPos);
  let best: (ActiveTriggerState & { idx: number }) | null = null;

  for (const t of triggers) {
    if (!t) continue;
    let searchStart = 0;
    while (searchStart <= before.length) {
      const idx = before.indexOf(t, searchStart);
      if (idx === -1) break;
      const prev = idx === 0 ? " " : before[idx - 1];
      if (idx > 0 && !/\s/.test(prev)) {
        searchStart = idx + 1;
        continue;
      }
      const after = before.slice(idx + t.length);
      if (/\s/.test(after) || after.includes("\n")) {
        searchStart = idx + 1;
        continue;
      }
      const state = {
        trigger: t,
        query: after,
        replaceFrom: idx,
        replaceTo: cursorPos,
        idx,
      };
      if (!best || idx > best.idx) {
        best = state;
      }
      searchStart = idx + 1;
    }
  }

  if (!best) return null;
  return {
    trigger: best.trigger,
    query: best.query,
    replaceFrom: best.replaceFrom,
    replaceTo: best.replaceTo,
  };
}

export function filterTriggerMenuItems<T extends TriggerMenuItemBase>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) return true;
    const extra = (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
    if (extra) return true;
    return label.includes(q);
  });
}
