import type { RefObject } from "react";
import { Square, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ComposerNoteRef, ComposerCalendarRef } from "./chat-helpers";

interface ComposerMenu {
  menuVisible: boolean;
  filteredItems: {
    id: string;
    label: string;
    description?: string;
  }[];
  emptyHint: string | null | undefined;
  selectedIndex: number;
  onMenuItemMouseDown: (e: React.MouseEvent) => void;
  highlightItem: (index: number) => void;
  pickItem: (index: number) => void;
  syncSelectionFromEvent: (el: HTMLInputElement | HTMLTextAreaElement) => void;
}

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  composerNoteRefs: ComposerNoteRef[];
  composerCalendarRefs: ComposerCalendarRef[];
  onRemoveNoteRef: (documentId: string) => void;
  onRemoveCalendarRef: (subscriptionId: string) => void;
  onNoteClick: (documentId: string) => void;
  streaming: boolean;
  chatModelReady: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  composerMenu: ComposerMenu;
  composerFieldRef: RefObject<HTMLDivElement | null>;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  sendError: string | null;
}

export function ChatComposer({
  input,
  onInputChange,
  composerNoteRefs,
  composerCalendarRefs,
  onRemoveNoteRef,
  onRemoveCalendarRef,
  onNoteClick,
  streaming,
  chatModelReady,
  canSend,
  onSend,
  onStop,
  composerMenu,
  composerFieldRef,
  composerInputRef,
  onKeyDown,
  sendError,
}: ChatComposerProps) {
  return (
    <div className="relative flex shrink-0 items-end gap-2 border-t border-border-soft px-3 py-2.5">
      {composerMenu.menuVisible ? (
        <div
          className="absolute bottom-full left-0 right-9 z-20 mb-1.5 max-h-[220px] overflow-y-auto rounded-[10px] border border-border-soft bg-[rgba(28,28,36,0.98)] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
          role="listbox"
          aria-label="Composer commands"
        >
          {composerMenu.filteredItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === composerMenu.selectedIndex}
              className={cn(
                "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left text-[0.82rem] text-foreground transition-colors hover:bg-white/[0.08]",
                index === composerMenu.selectedIndex && "bg-white/[0.08]",
              )}
              onMouseDown={composerMenu.onMenuItemMouseDown}
              onMouseEnter={() => composerMenu.highlightItem(index)}
              onClick={() => composerMenu.pickItem(index)}
            >
              <span className="font-medium">{item.label}</span>
              {item.description ? (
                <span className="text-[0.72rem] leading-snug text-muted">{item.description}</span>
              ) : null}
            </button>
          ))}
          {composerMenu.filteredItems.length === 0 && composerMenu.emptyHint ? (
            <div className="px-3 py-2.5 text-[0.78rem] italic text-muted" role="status">
              {composerMenu.emptyHint}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {composerCalendarRefs.length > 0 || composerNoteRefs.length > 0 ? (
          <div
            className="flex flex-wrap gap-1.5"
            role="list"
            aria-label="Items referenced in this message"
          >
            {composerCalendarRefs.map((c) => (
              <div
                key={c.subscriptionId}
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.12)] py-1 pr-1 pl-2.5"
                role="listitem"
              >
                <span className="min-w-0 flex-1 truncate py-0.5 text-[0.72rem] font-medium leading-snug text-[rgba(147,197,253,0.98)]">
                  {c.name}
                </span>
                <button
                  type="button"
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-[background-color,color] hover:bg-white/[0.08] hover:text-foreground"
                  aria-label={`Remove calendar: ${c.name}`}
                  onClick={() => onRemoveCalendarRef(c.subscriptionId)}
                >
                  <X size={12} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            ))}
            {composerNoteRefs.map((n) => (
              <div
                key={n.documentId}
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.12)] py-1 pr-1 pl-2.5"
                role="listitem"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-0.5 text-left font-[inherit] text-[0.72rem] font-medium leading-snug text-[rgba(196,181,253,0.98)] transition-colors hover:text-foreground"
                  onClick={() => onNoteClick(n.documentId)}
                >
                  {n.title}
                </button>
                <button
                  type="button"
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-[background-color,color] hover:bg-white/[0.08] hover:text-foreground"
                  aria-label={`Remove reference: ${n.title}`}
                  onClick={() => onRemoveNoteRef(n.documentId)}
                >
                  <X size={12} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          ref={composerFieldRef}
          className={cn(
            "relative min-h-[calc(0.82rem*1.45+18px)] min-w-0 flex-1 rounded-lg bg-white/[0.05] transition-[background,opacity] duration-100 focus-within:bg-white/[0.09]",
            (streaming || !chatModelReady) && "cursor-not-allowed opacity-55",
          )}
        >
          <textarea
            ref={composerInputRef}
            className="box-border m-0 block min-h-[calc(0.82rem*1.45+18px)] w-full resize-none overflow-x-hidden rounded-lg border-0 bg-transparent px-3 py-2.5 font-[inherit] text-[0.82rem] leading-snug text-foreground outline-none transition-opacity placeholder:text-faint disabled:cursor-not-allowed"
            rows={1}
            value={input}
            onChange={(e) => {
              composerMenu.syncSelectionFromEvent(e.target);
              onInputChange(e.target.value);
            }}
            onSelect={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
            onClick={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
            onKeyUp={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
            onKeyDown={onKeyDown}
            placeholder={
              chatModelReady
                ? "Ask anything… ( / commands · @ mentions )"
                : "Configure a chat model in Settings…"
            }
            disabled={streaming || !chatModelReady}
          />
        </div>
      </div>
      {streaming ? (
        <button
          type="button"
          className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white/[0.08] text-foreground transition-[background-color,color] duration-150 hover:bg-red-500/[0.18] hover:text-red-200"
          onClick={onStop}
          aria-label="Stop generating"
        >
          <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white/[0.08] text-muted transition-[background-color,color,opacity] duration-150 hover:bg-white/[0.12] hover:text-foreground disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:opacity-35"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
