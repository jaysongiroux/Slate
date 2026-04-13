import type { RefObject } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ConversationResponse } from "../../lib/api";

interface ConversationListProps {
  conversations: ConversationResponse[];
  filteredConversations: ConversationResponse[];
  activeConversationId: string | null;
  conversationSearch: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onPickConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
}

export function ConversationList({
  filteredConversations,
  activeConversationId,
  conversationSearch,
  onSearchChange,
  searchRef,
  onPickConversation,
  onDeleteConversation,
  onNewConversation,
}: ConversationListProps) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Conversations">
      <div className="shrink-0 pb-3.5 pt-0.5">
        <input
          ref={searchRef}
          type="search"
          className="box-border w-full rounded-lg border-0 bg-white/[0.05] px-[11px] py-2 text-[0.82rem] text-foreground outline-none transition-colors placeholder:text-faint focus:bg-white/[0.09]"
          placeholder="Search…"
          value={conversationSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {filteredConversations.length === 0 ? (
          <div className="px-3 py-7 pb-10 text-center text-[0.82rem] leading-snug text-faint">
            {conversationSearch.trim() ? "No matches" : "No conversations yet"}
          </div>
        ) : (
          <ul className="m-0 list-none p-0 pb-2">
            {filteredConversations.map((conv, idx, arr) => {
              const isActive = conv.id === activeConversationId;
              const title = conv.title ?? "New Conversation";
              const isLast = idx === arr.length - 1;
              return (
                <li key={conv.id} className="m-0">
                  <div
                    className={cn(
                      "flex min-h-0 items-stretch",
                      !isLast && "border-b border-border-soft",
                      isActive && "bg-white/[0.06] shadow-[inset_2px_0_0_rgba(255,255,255,0.18)]",
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "m-0 flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 border-0 bg-transparent py-2.5 pr-2 pl-[11px] text-left font-[inherit] text-foreground transition-colors",
                        isActive ? "hover:bg-white/[0.03]" : "hover:bg-white/[0.04]",
                      )}
                      onClick={() => onPickConversation(conv.id)}
                    >
                      <span className="w-full truncate text-[0.82rem] font-medium">{title}</span>
                      <span className="text-[0.72rem] text-faint">
                        {conv.messageCount} {conv.messageCount === 1 ? "message" : "messages"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="m-0 inline-flex w-[38px] shrink-0 cursor-pointer items-center justify-center border-0 border-l border-border-soft bg-transparent p-0 text-faint transition-[color,background-color] hover:bg-[rgba(255,156,148,0.08)] hover:text-danger"
                      aria-label={`Delete conversation: ${title}`}
                      onClick={() => onDeleteConversation(conv.id)}
                    >
                      <X size={14} strokeWidth={2.25} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-border-soft py-2.5">
        <button
          type="button"
          className="m-0 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-white/[0.06] py-2.5 px-3 font-[inherit] text-[0.82rem] font-medium text-foreground transition-colors hover:bg-white/10"
          onClick={onNewConversation}
        >
          <MessageSquarePlus size={14} strokeWidth={2.25} aria-hidden />
          New conversation
        </button>
      </div>
    </nav>
  );
}
