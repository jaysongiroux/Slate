import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from "react";
import { ChevronLeft, List, MessageSquarePlus, Square, X } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import * as api from "../lib/api";
import type { LocalNoteSummary } from "@slate/shared";
import {
  isSendMessageCancelled,
  type AiConfigResponse,
  type ConversationResponse,
  type SendMessageEvent,
} from "../lib/api";
import {
  useComposerTriggerMenu,
  type ComposerTriggerMenuConfig,
} from "../hooks/useComposerTriggerMenu";

/** Matches notes sidebar heading icon buttons (Tailwind; old .sidebar-heading__button CSS was removed). */
const chatHeadingIconBtnClass =
  "inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-faint transition-colors hover:bg-white/[0.08] hover:text-foreground";

export interface ChatSidebarHandle {
  openConversationList: () => void;
  newConversation: () => void;
}

interface ChatSidebarProps {
  /** When this flips true after login, AI config and conversations reload without closing the panel. */
  backendAuthenticated: boolean;
  notes: LocalNoteSummary[];
  onNoteClick: (documentId: string) => void;
  onOpenNoteInEditor: (documentId: string) => void;
  onBackToNotes: () => void;
}

const CHAT_COMPOSER_MAX_LINES = 4;

/** Map raw provider + model config to a clean display label. */
function getChatModelDisplayName(provider?: string, model?: string): string {
  const m = model?.trim() ?? "";
  if (!m) return "";

  const KNOWN: Record<string, string> = {
    "claude-sonnet-4-20250514": "Claude Sonnet",
    "claude-haiku-4-5-20251001": "Claude Haiku",
    "claude-opus-4-20250514": "Claude Opus",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "o3-mini": "o3 Mini",
  };

  if (KNOWN[m]) return KNOWN[m];

  // Pattern-based fallbacks for Anthropic models: "claude-sonnet-4-xxx" → "Claude Sonnet"
  const claudeMatch = m.match(/^claude-(\w+)/);
  if (claudeMatch) {
    return `Claude ${claudeMatch[1].charAt(0).toUpperCase()}${claudeMatch[1].slice(1)}`;
  }

  // GPT pattern: "gpt-5" → "GPT-5"
  if (m.startsWith("gpt-")) {
    return m
      .replace("gpt-", "GPT-")
      .replace(/-/g, " ")
      .replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // o-series pattern: "o4-mini" → "o4 Mini"
  if (/^o\d/.test(m)) {
    return m.replace(/-/g, " ").replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // Pass through raw model string for Ollama / OpenAI-compatible / unknown
  return m;
}

/** Markdown link label must not contain `]` (see ChatMessage NOTE_LINK_RE). */
function safeNoteLinkTitle(title: string): string {
  return title.replace(/\]/g, "");
}

interface MessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

interface ComposerNoteRef {
  documentId: string;
  title: string;
}

export const ChatSidebar = forwardRef<ChatSidebarHandle, ChatSidebarProps>(function ChatSidebar(
  { backendAuthenticated, notes, onNoteClick, onOpenNoteInEditor, onBackToNotes },
  ref,
) {
  const [conversations, setConversations] = useState<ConversationResponse[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [composerNoteRefs, setComposerNoteRefs] = useState<ComposerNoteRef[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfigResponse | null>(null);
  const [aiConfigLoading, setAiConfigLoading] = useState(true);
  const [activeNoteWrite, setActiveNoteWrite] = useState<{
    documentId: string;
    title: string;
    content: string;
  } | null>(null);
  const lastNoteSyncRef = useRef(0);
  const noteActiveRef = useRef(false);
  /** Batches assistant token IPC events to one React update per animation frame. */
  const streamTokenBufRef = useRef("");
  const streamTokenRafRef = useRef<number | null>(null);
  const streamAssistantMsgIdRef = useRef<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationSearchRef = useRef<HTMLInputElement>(null);
  const composerFieldRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  /** Suppresses the smooth scroll on initial conversation load. */
  const skipSmoothScrollRef = useRef(false);
  /** Message IDs loaded in bulk — these skip the fade-in animation. */
  const bulkLoadedIdsRef = useRef<Set<string>>(new Set());

  const loadAiConfig = useCallback(async () => {
    try {
      const c = await api.getAiConfig();
      setAiConfig(c);
    } catch {
      setAiConfig(null);
    } finally {
      setAiConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    const onCfg = () => void loadAiConfig();
    window.addEventListener("slate-ai-config-changed", onCfg);
    return () => {
      window.removeEventListener("slate-ai-config-changed", onCfg);
    };
  }, [loadAiConfig]);

  useEffect(() => {
    if (!backendAuthenticated) {
      setAiConfig(null);
      setAiConfigLoading(false);
      return;
    }
    setAiConfigLoading(true);
    void loadAiConfig();
  }, [backendAuthenticated, loadAiConfig]);

  const chatModelReady = Boolean(aiConfig?.chatProvider?.trim() && aiConfig?.chatModel?.trim());

  const loadConversations = async () => {
    try {
      const list = await api.listConversations();
      setConversations(list);
    } catch {
      // ignore
    }
  };

  const selectConversationById = useCallback(async (id: string | null) => {
    setActiveConversationId(id);
    setToolStatus(null);
    try {
      await api.setLastActiveChatConversationId(id);
    } catch {
      // ignore
    }
    if (!id) {
      setMessages([]);
      return;
    }
    try {
      skipSmoothScrollRef.current = true;
      const msgs = await api.getConversationMessages(id);
      bulkLoadedIdsRef.current = new Set(msgs.map((m) => m.id));
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      );
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!backendAuthenticated) {
      setConversations([]);
      void selectConversationById(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listConversations();
        if (cancelled) return;
        setConversations(list);
        let saved: string | null = null;
        try {
          saved = await api.getLastActiveChatConversationId();
        } catch {
          saved = null;
        }
        if (cancelled) return;
        const id = saved && list.some((c) => c.id === saved) ? saved : (list[0]?.id ?? null);
        if (cancelled) return;
        await selectConversationById(id);
      } catch {
        if (!cancelled) setConversations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendAuthenticated, selectConversationById]);

  useEffect(() => {
    if (skipSmoothScrollRef.current) {
      skipSmoothScrollRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, toolStatus]);

  const handleNewConversation = useCallback(async () => {
    try {
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      await selectConversationById(conv.id);
      setConversationsOpen(false);
    } catch {
      // ignore
    }
  }, [selectConversationById]);

  const addComposerNoteRef = useCallback((ref: ComposerNoteRef) => {
    setComposerNoteRefs((prev) =>
      prev.some((n) => n.documentId === ref.documentId) ? prev : [...prev, ref],
    );
  }, []);

  const removeComposerNoteRef = useCallback((documentId: string) => {
    setComposerNoteRefs((prev) => prev.filter((n) => n.documentId !== documentId));
  }, []);

  const mentionMenuItems = useMemo(() => {
    const alive = notes.filter((n) => !n.deleted);
    const sorted = [...alive].sort((a, b) => a.path.localeCompare(b.path));
    return sorted.map((note) => {
      const label = note.title || note.path.split("/").pop() || "Untitled";
      return {
        id: `note-${note.id}`,
        label,
        description: note.path,
        keywords: [note.path, note.title, ...note.path.split("/").filter(Boolean)],
        insertText: "",
        execute: () => {
          addComposerNoteRef({ documentId: note.id, title: label });
        },
      };
    });
  }, [notes, addComposerNoteRef]);

  const adjustComposerSize = useCallback(() => {
    const ta = composerInputRef.current;
    if (!ta) return;

    ta.style.height = "auto";
    const cs = getComputedStyle(ta);
    let lineHeight = parseFloat(cs.lineHeight);
    if (Number.isNaN(lineHeight) || lineHeight <= 0) {
      lineHeight = parseFloat(cs.fontSize) * 1.35;
    }
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const maxH = Math.ceil(lineHeight * CHAT_COMPOSER_MAX_LINES + padY + borderY);
    const next = Math.min(ta.scrollHeight, maxH);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
    ta.style.overflowX = "hidden";
  }, []);

  useLayoutEffect(() => {
    adjustComposerSize();
  }, [input, adjustComposerSize]);

  useLayoutEffect(() => {
    const el = composerFieldRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => adjustComposerSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [adjustComposerSize]);

  const composerTriggerConfigs = useMemo<ComposerTriggerMenuConfig[]>(
    () => [
      {
        trigger: "/",
        items: [
          {
            id: "reset",
            label: "reset",
            description: "Start a new conversation (clear context)",
            keywords: ["new", "clear", "context"],
            execute: () => {
              void handleNewConversation();
            },
          },
        ],
      },
      {
        trigger: "@",
        items: mentionMenuItems,
        emptyHint: "No notes to mention",
      },
    ],
    [handleNewConversation, mentionMenuItems],
  );

  const composerMenu = useComposerTriggerMenu({
    value: input,
    setValue: setInput,
    configs: composerTriggerConfigs,
    inputRef: composerInputRef,
    disabled: streaming || !chatModelReady,
  });

  useImperativeHandle(ref, () => ({
    openConversationList: () => setConversationsOpen(true),
    newConversation: () => {
      void handleNewConversation();
    },
  }));

  const handleSelectConversation = (id: string) => {
    void selectConversationById(id);
  };

  const pickConversation = (id: string) => {
    handleSelectConversation(id);
    setConversationsOpen(false);
  };

  useEffect(() => {
    if (!conversationsOpen) {
      setConversationSearch("");
      return;
    }
    const t = window.setTimeout(() => conversationSearchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [conversationsOpen]);

  useEffect(() => {
    if (!conversationsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setConversationsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversationsOpen]);

  const filteredConversations = conversationSearch.trim()
    ? conversations.filter((c) =>
        (c.title ?? "New Conversation").toLowerCase().includes(conversationSearch.toLowerCase()),
      )
    : conversations;

  const handleDeleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      const wasActive = activeConversationId === id;
      const nextList = conversations.filter((c) => c.id !== id);
      setConversations(nextList);
      if (wasActive) {
        await selectConversationById(nextList[0]?.id ?? null);
      }
    } catch {
      // ignore
    }
  };

  const buildOutgoingMessage = useCallback(() => {
    const trimmed = input.trim();
    const linkBlock = composerNoteRefs
      .map((n) => ` [${safeNoteLinkTitle(n.title)}](note://${n.documentId})`)
      .join("");
    const body = linkBlock && trimmed ? `${linkBlock} ${trimmed}` : linkBlock || trimmed;
    return body.trim();
  }, [input, composerNoteRefs]);

  const canSend = chatModelReady && !streaming && Boolean(buildOutgoingMessage());

  const handleStop = useCallback(() => {
    void api.cancelSendMessage();
  }, []);

  const handleSend = async () => {
    const text = buildOutgoingMessage();
    if (!text || streaming || !chatModelReady) return;

    setInput("");
    setComposerNoteRefs([]);
    setStreaming(true);
    setToolStatus(null);
    setSendError(null);

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const conv = await api.createConversation();
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        conversationId = conv.id;
        void api.setLastActiveChatConversationId(conv.id);
      } catch {
        setStreaming(false);
        return;
      }
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;
    streamAssistantMsgIdRef.current = assistantMsgId;
    streamTokenBufRef.current = "";

    const flushPendingStreamTokens = () => {
      if (streamTokenRafRef.current != null) {
        cancelAnimationFrame(streamTokenRafRef.current);
        streamTokenRafRef.current = null;
      }
      const id = streamAssistantMsgIdRef.current;
      const chunk = streamTokenBufRef.current;
      streamTokenBufRef.current = "";
      if (!chunk || !id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
      );
    };

    const queueStreamToken = (token: string) => {
      streamTokenBufRef.current += token;
      if (streamTokenRafRef.current != null) return;
      streamTokenRafRef.current = requestAnimationFrame(() => {
        streamTokenRafRef.current = null;
        const id = streamAssistantMsgIdRef.current;
        const chunk = streamTokenBufRef.current;
        streamTokenBufRef.current = "";
        if (!chunk || !id) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
        );
      });
    };

    const dropAssistantPlaceholder = () => {
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    };

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "USER", content: text },
      { id: assistantMsgId, role: "ASSISTANT", content: "" },
    ]);

    try {
      const invokeResult = await api.sendMessage(
        conversationId,
        text,
        (event: SendMessageEvent) => {
          if (event.type === "error") {
            streamTokenBufRef.current = "";
            if (streamTokenRafRef.current != null) {
              cancelAnimationFrame(streamTokenRafRef.current);
              streamTokenRafRef.current = null;
            }
            dropAssistantPlaceholder();
            setSendError(event.content?.trim() || "Something went wrong.");
            return;
          }
          if (event.type === "token" && event.content) {
            // Don't accumulate tokens while a note operation is active —
            // the writing preview card is the only visible indicator.
            if (!noteActiveRef.current) {
              queueStreamToken(event.content);
            }
          } else if (event.type === "tool_call" && event.toolName) {
            if (event.toolName === "create_note" || event.toolName === "edit_note") {
              noteActiveRef.current = true;
            } else {
              setToolStatus(`Using tool: ${event.toolName}…`);
            }
          } else if (event.type === "done") {
            flushPendingStreamTokens();
            setToolStatus(null);
          } else if (event.type === "note_create_start" || event.type === "note_edit_start") {
            setActiveNoteWrite({
              documentId: event.documentId!,
              title: event.title!,
              content: "",
            });
            api
              .syncNow()
              .then(() => onOpenNoteInEditor(event.documentId!))
              .catch(() => {});
          } else if (event.type === "note_delta" && event.content) {
            setActiveNoteWrite((prev) =>
              prev ? { ...prev, content: prev.content + event.content } : prev,
            );
            const now = Date.now();
            if (now - lastNoteSyncRef.current >= 800) {
              lastNoteSyncRef.current = now;
              api.syncNow().catch(() => {});
            }
          } else if (event.type === "note_done") {
            noteActiveRef.current = false;
            if (event.error) {
              setSendError(`Note writing failed: ${event.error}`);
            }
            setActiveNoteWrite(null);
            api.syncNow().catch(() => {});
          }
        },
      );
      if (isSendMessageCancelled(invokeResult)) {
        flushPendingStreamTokens();
        setMessages((prev) => prev.filter((m) => !(m.id === assistantMsgId && m.content === "")));
      }
    } catch (err) {
      streamTokenBufRef.current = "";
      if (streamTokenRafRef.current != null) {
        cancelAnimationFrame(streamTokenRafRef.current);
        streamTokenRafRef.current = null;
      }
      dropAssistantPlaceholder();
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      flushPendingStreamTokens();
      streamAssistantMsgIdRef.current = null;
      setStreaming(false);
      setToolStatus(null);
      noteActiveRef.current = false;
      loadConversations();
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composerMenu.onKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showTypingIndicator =
    streaming &&
    !toolStatus &&
    lastMessage?.role === "ASSISTANT" &&
    lastMessage.content.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between gap-2 text-[0.88rem] text-muted tracking-wide">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[0.9rem] font-normal tracking-wide text-foreground">
            Chat
          </span>
          {chatModelReady && aiConfig?.chatModel ? (
            <span className="min-w-0 max-w-[120px] truncate text-[0.72rem] tracking-wide text-faint">
              {getChatModelDisplayName(aiConfig.chatProvider, aiConfig.chatModel)}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  chatHeadingIconBtnClass,
                  conversationsOpen && "bg-white/[0.1] text-foreground",
                )}
                onClick={() => setConversationsOpen((o) => !o)}
                aria-label={conversationsOpen ? "Back to chat" : "Browse conversations"}
                aria-pressed={conversationsOpen}
              >
                <List size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {conversationsOpen ? "Back to chat" : "Browse and switch conversations"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={chatHeadingIconBtnClass}
                onClick={() => {
                  void handleNewConversation();
                }}
                aria-label="New conversation"
              >
                <MessageSquarePlus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Start a new chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {conversationsOpen ? (
        <nav className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Conversations">
          <div className="shrink-0 pb-3.5 pt-0.5">
            <input
              ref={conversationSearchRef}
              type="search"
              className="box-border w-full rounded-lg border-0 bg-white/[0.05] px-[11px] py-2 text-[0.82rem] text-foreground outline-none transition-colors placeholder:text-faint focus:bg-white/[0.09]"
              placeholder="Search…"
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
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
                          isActive &&
                            "bg-white/[0.06] shadow-[inset_2px_0_0_rgba(255,255,255,0.18)]",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "m-0 flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 border-0 bg-transparent py-2.5 pr-2 pl-[11px] text-left font-[inherit] text-foreground transition-colors",
                            isActive ? "hover:bg-white/[0.03]" : "hover:bg-white/[0.04]",
                          )}
                          onClick={() => pickConversation(conv.id)}
                        >
                          <span className="w-full truncate text-[0.82rem] font-medium">
                            {title}
                          </span>
                          <span className="text-[0.72rem] text-faint">
                            {conv.messageCount} {conv.messageCount === 1 ? "message" : "messages"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="m-0 inline-flex w-[38px] shrink-0 cursor-pointer items-center justify-center border-0 border-l border-border-soft bg-transparent p-0 text-faint transition-[color,background-color] hover:bg-[rgba(255,156,148,0.08)] hover:text-danger"
                          aria-label={`Delete conversation: ${title}`}
                          onClick={() => handleDeleteConversation(conv.id)}
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
              onClick={() => {
                void handleNewConversation();
              }}
            >
              <MessageSquarePlus size={14} strokeWidth={2.25} aria-hidden />
              New conversation
            </button>
          </div>
        </nav>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-3 text-center text-[13px] text-foreground/50">
                Ask a question about your notes
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      bulkLoadedIdsRef.current.has(msg.id)
                        ? undefined
                        : "motion-safe:animate-[chat-msg-in_0.25s_ease-out_both] motion-reduce:animate-none"
                    }
                  >
                    <ChatMessage role={msg.role} content={msg.content} onNoteClick={onNoteClick} />
                  </div>
                ))}
                {toolStatus && (
                  <div className="px-0 py-2 pb-1 text-[0.72rem] italic leading-snug text-muted">
                    {toolStatus}
                  </div>
                )}
                {activeNoteWrite && (
                  <div
                    className="mx-3 my-1 rounded-md border border-white/10 bg-white/[0.05] p-2 text-xs"
                    aria-live="polite"
                  >
                    <div className="mb-1 font-semibold opacity-70">
                      Tool: Writing note: {activeNoteWrite.title}
                    </div>
                    <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words font-[ui-monospace,'SF_Mono',SFMono-Regular,Menlo,Monaco,Consolas,monospace] text-[11px] leading-snug opacity-85">
                      {activeNoteWrite.content || "…"}
                    </div>
                  </div>
                )}
                {showTypingIndicator ? (
                  <div
                    className="flex min-h-[28px] items-center gap-1.5 py-0.5 pb-2.5"
                    aria-live="polite"
                    aria-label="Assistant is typing"
                  >
                    <span className="inline-flex items-center gap-1" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="size-[5px] rounded-full bg-faint motion-safe:animate-[chat-typing-pulse_1.15s_ease-in-out_infinite] motion-reduce:animate-none"
                          style={{ animationDelay: `${i * 0.14}s` }}
                        />
                      ))}
                    </span>
                  </div>
                ) : null}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {sendError ? (
            <div
              className="mx-3 mb-2 shrink-0 rounded-lg border border-[rgba(255,156,148,0.2)] bg-[rgba(255,156,148,0.08)] px-2.5 py-2 text-[0.78rem] leading-snug text-danger"
              role="alert"
            >
              {sendError}
            </div>
          ) : null}
          {!aiConfigLoading && !chatModelReady ? (
            <div className="mx-3 mb-2 shrink-0 rounded-lg border border-border-soft bg-white/[0.03] px-2.5 py-2 text-[0.78rem] leading-snug text-muted">
              Select a chat model in Settings to send messages.
            </div>
          ) : null}

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
                      <span className="text-[0.72rem] leading-snug text-muted">
                        {item.description}
                      </span>
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
              {composerNoteRefs.length > 0 ? (
                <div
                  className="flex flex-wrap gap-1.5"
                  role="list"
                  aria-label="Notes referenced in this message"
                >
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
                        onClick={() => removeComposerNoteRef(n.documentId)}
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
                    setInput(e.target.value);
                    if (sendError) setSendError(null);
                  }}
                  onSelect={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
                  onClick={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
                  onKeyUp={(e) => composerMenu.syncSelectionFromEvent(e.currentTarget)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={
                    chatModelReady
                      ? "Ask anything… ( / commands · @ notes )"
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
                onClick={handleStop}
                aria-label="Stop generating"
              >
                <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white/[0.08] text-muted transition-[background-color,color,opacity] duration-150 hover:bg-white/[0.12] hover:text-foreground disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:opacity-35"
                onClick={() => void handleSend()}
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
        </>
      )}
    </div>
  );
});

ChatSidebar.displayName = "ChatSidebar";
