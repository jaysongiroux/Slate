import { useKeyboardShortcuts } from "../../lib/shortcuts";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

const SHORTCUT_LABELS: Record<string, string> = {
  "command-bar": "Command bar",
  "export-notes": "Export notes (markdown zip)",
  "find-in-note": "Find in note",
  "new-note": "New note / event",
  "toggle-sidebar": "Toggle sidebar",
  "tab-notes": "Notes tab",
  "tab-calendar": "Calendar tab",
  "tab-chat": "AI Chat tab",
};

export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      const p = part.toLowerCase();
      if (p === "mod") return isMac ? "\u2318" : "Ctrl";
      if (p === "shift") return isMac ? "\u21E7" : "Shift";
      if (p === "alt") return isMac ? "\u2325" : "Alt";
      return p.toUpperCase();
    })
    .join(isMac ? "" : "+");
}

export function KeyboardShortcutsSection() {
  const { shortcuts } = useKeyboardShortcuts();

  return (
    <div className="grid gap-4">
      <p className="text-[0.84rem] text-muted">Keyboard shortcuts used throughout the app.</p>
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className="border-b border-border-soft text-left text-muted">
            <th className="pb-2 font-medium">Action</th>
            <th className="pb-2 text-right font-medium">Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(shortcuts).map(([action, shortcut]) => (
            <tr key={action} className="border-b border-border-soft/50">
              <td className="py-2 text-foreground">{SHORTCUT_LABELS[action] ?? action}</td>
              <td className="py-2 text-right">
                <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.78rem] text-muted">
                  {formatShortcut(shortcut)}
                </kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
