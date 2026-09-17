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
import { List, MessageSquarePlus } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import * as api from "../lib/api";
import type { LocalNoteSummary } from "@slate/shared";
import { displayNoteTitle } from "../lib/note-display.mjs";
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
import {
  chatHeadingIconBtnClass,
  AI_NOTE_STREAM_EVENT,
  CHAT_COMPOSER_MAX_LINES,
  getChatModelDisplayName,
  safeNoteLinkTitle,
  type AiNoteStreamDetail,
  type MessageItem,
  type ComposerNoteRef,
  type ComposerCalendarRef,
} from "./chat/chat-helpers";
import { ConversationList } from "./chat/ConversationList";
import { ChatComposer } from "./chat/ChatComposer";

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

export const ChatSidebar = forwardRef<ChatSidebarHandle, ChatSidebarProps>(function ChatSidebar(
  { backendAuthenticated, notes, onNoteClick, onOpenNoteInEditor, onBackToNotes },
  ref,
) {
  const [conversations, setConversations] = useState<ConversationResponse[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [composerNoteRefs, setComposerNoteRefs] = useState<ComposerNoteRef[]>([]);
  const [composerCalendarRefs, setComposerCalendarRefs] = useState<ComposerCalendarRef[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<api.CalendarStatusResponse | null>(null);
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
  const activeNoteStreamContentRef = useRef("");
  const activeNoteStreamKindRef = useRef<"create" | "edit">("create");
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

  const dispatchAiNoteStream = useCallback((detail: AiNoteStreamDetail) => {
    window.dispatchEvent(new CustomEvent(AI_NOTE_STREAM_EVENT, { detail }));
  }, []);

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

  const loadCalendarStatus = useCallback(async () => {
    try {
      const status = await api.getCalendarStatus();
      setCalendarStatus(status);
    } catch {
      setCalendarStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!backendAuthenticated) return;
    void loadCalendarStatus();
  }, [backendAuthenticated, loadCalendarStatus]);

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
          metadata: m.metadata ?? null,
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

  const addComposerCalendarRef = useCallback((ref: ComposerCalendarRef) => {
    setComposerCalendarRefs((prev) =>
      prev.some((c) => c.subscriptionId === ref.subscriptionId) ? prev : [...prev, ref],
    );
  }, []);

  const removeComposerCalendarRef = useCallback((subscriptionId: string) => {
    setComposerCalendarRefs((prev) => prev.filter((c) => c.subscriptionId !== subscriptionId));
  }, []);

  const calendarMenuItems = useMemo(() => {
    if (!calendarStatus) return [];
    const items: {
      id: string;
      label: string;
      description: string;
      keywords: string[];
      insertText: string;
      execute: () => void;
    }[] = [];
    for (const conn of calendarStatus.connections) {
      for (const cal of conn.calendars) {
        items.push({
          id: `cal-${cal.subscriptionId}`,
          label: cal.name,
          description: `Calendar · ${conn.email}`,
          keywords: [cal.name, conn.email, conn.provider, "calendar"],
          insertText: "",
          execute: () => {
            addComposerCalendarRef({
              subscriptionId: cal.subscriptionId,
              name: cal.name,
              source: "provider",
            });
          },
        });
      }
    }
    for (const ics of calendarStatus.icsSubscriptions) {
      items.push({
        id: `ics-${ics.id}`,
        label: ics.name,
        description: "Calendar · ICS feed",
        keywords: [ics.name, "ics", "calendar"],
        insertText: "",
        execute: () => {
          addComposerCalendarRef({ subscriptionId: ics.id, name: ics.name, source: "ics" });
        },
      });
    }
    return items;
  }, [calendarStatus, addComposerCalendarRef]);

  const mentionMenuItems = useMemo(() => {
    const alive = notes.filter((n) => !n.deleted);
    const sorted = [...alive].sort((a, b) => a.path.localeCompare(b.path));
    const noteItems = sorted.map((note) => {
      const label = displayNoteTitle(note);
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
    return [...calendarMenuItems, ...noteItems];
  }, [notes, addComposerNoteRef, calendarMenuItems]);

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
        emptyHint: "No notes or calendars to mention",
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
    const calendarBlock = composerCalendarRefs
      .map((c) => ` [${safeNoteLinkTitle(c.name)}](calendar://${c.subscriptionId})`)
      .join("");
    const noteBlock = composerNoteRefs
      .map((n) => ` [${safeNoteLinkTitle(n.title)}](note://${n.documentId})`)
      .join("");
    const linkBlock = calendarBlock + noteBlock;
    const body = linkBlock && trimmed ? `${linkBlock} ${trimmed}` : linkBlock || trimmed;
    return body.trim();
  }, [input, composerNoteRefs, composerCalendarRefs]);

  const canSend = chatModelReady && !streaming && Boolean(buildOutgoingMessage());

  const handleStop = useCallback(() => {
    void api.cancelSendMessage();
  }, []);

  /**
   * Runs one chat turn. `retryOf` re-runs the question already in history instead
   * of asking it again, so the backend does not persist a duplicate user message.
   */
  const handleSend = async (retryOf?: { text: string }) => {
    const retry = Boolean(retryOf);
    const text = retryOf?.text ?? buildOutgoingMessage();
    if (!text || streaming || !chatModelReady) return;

    const scopedCalendarRefs = retry ? [] : [...composerCalendarRefs];
    if (!retry) {
      setInput("");
      setComposerNoteRefs([]);
      setComposerCalendarRefs([]);
    }
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

    if (retry) {
      // Mirror the backend: drop the failed turn's replies, keep the question.
      setMessages((prev) => {
        const kept = [...prev];
        while (kept.length > 0 && kept[kept.length - 1].role === "ASSISTANT") {
          kept.pop();
        }
        return [...kept, { id: assistantMsgId, role: "ASSISTANT", content: "" }];
      });
    } else {
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "USER", content: text },
        { id: assistantMsgId, role: "ASSISTANT", content: "" },
      ]);
    }

    // Build AI-enabled calendar IDs: use @-scoped calendars if any, else all subscribed
    let enabledCalendarIds: string[] = [];
    let enabledIcsIds: string[] = [];
    if (scopedCalendarRefs.length > 0) {
      enabledCalendarIds = scopedCalendarRefs
        .filter((c) => c.source === "provider")
        .map((c) => c.subscriptionId);
      enabledIcsIds = scopedCalendarRefs
        .filter((c) => c.source === "ics")
        .map((c) => c.subscriptionId);
    } else {
      try {
        const calStatus = await api.getCalendarStatus();
        enabledCalendarIds = calStatus.connections.flatMap((c: any) =>
          c.calendars.map((cal: any) => cal.subscriptionId),
        );
        enabledIcsIds = calStatus.icsSubscriptions.map((s: any) => s.id);
      } catch {
        // Calendar not configured — tools won't be registered, which is fine
      }
    }

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const invokeResult = await api.sendMessage(
        conversationId,
        text,
        (event: SendMessageEvent) => {
          if (event.type === "error") {
            // Keep whatever streamed before the failure, then append the notice —
            // the backend persists the same pair, so a reload looks identical.
            flushPendingStreamTokens();
            setMessages((prev) => [
              ...prev.filter((m) => !(m.id === assistantMsgId && m.content === "")),
              {
                id: `error-${Date.now()}`,
                role: "ASSISTANT",
                content: event.content?.trim() || "Something went wrong.",
                metadata: {
                  kind: "error",
                  code: event.code,
                  title: event.title,
                  detail: event.detail,
                  actionUrl: event.actionUrl,
                  retryable: event.retryable,
                },
              },
            ]);
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
            activeNoteStreamContentRef.current = "";
            activeNoteStreamKindRef.current =
              event.type === "note_create_start" ? "create" : "edit";
            dispatchAiNoteStream({
              documentId: event.documentId!,
              kind: activeNoteStreamKindRef.current,
              phase: "start",
              content: "",
            });
            setActiveNoteWrite({
              documentId: event.documentId!,
              title: event.title!,
              content: "",
            });
            onOpenNoteInEditor(event.documentId!);
          } else if (event.type === "note_delta" && event.content) {
            activeNoteStreamContentRef.current += event.content;
            dispatchAiNoteStream({
              documentId: event.documentId!,
              kind: activeNoteStreamKindRef.current,
              phase: "delta",
              content: activeNoteStreamContentRef.current,
            });
            setActiveNoteWrite((prev) =>
              prev ? { ...prev, content: prev.content + event.content } : prev,
            );
          } else if (event.type === "note_done") {
            noteActiveRef.current = false;
            if (event.documentId) {
              dispatchAiNoteStream({
                documentId: event.documentId,
                kind: activeNoteStreamKindRef.current,
                phase: "done",
                content: activeNoteStreamContentRef.current,
              });
            }
            activeNoteStreamContentRef.current = "";
            if (event.error) {
              setSendError(`Note writing failed: ${event.error}`);
            }
            setActiveNoteWrite(null);
          }
        },
        enabledCalendarIds,
        enabledIcsIds,
        timezone,
        { retry },
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
      activeNoteStreamContentRef.current = "";
      activeNoteStreamKindRef.current = "create";
      noteActiveRef.current = false;
      loadConversations();
    }
  };

  /** Re-runs the most recent question after a failed turn. */
  const handleRetry = () => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "USER");
    if (!lastUserMessage) return;
    void handleSend({ text: lastUserMessage.content });
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
        <ConversationList
          conversations={conversations}
          filteredConversations={filteredConversations}
          activeConversationId={activeConversationId}
          conversationSearch={conversationSearch}
          onSearchChange={setConversationSearch}
          searchRef={conversationSearchRef}
          onPickConversation={pickConversation}
          onDeleteConversation={(id) => void handleDeleteConversation(id)}
          onNewConversation={() => void handleNewConversation()}
        />
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
                    <ChatMessage
                      role={msg.role}
                      content={msg.content}
                      metadata={msg.metadata}
                      onNoteClick={onNoteClick}
                      onRetry={
                        msg.metadata?.kind === "error" &&
                        msg.id === messages[messages.length - 1]?.id
                          ? handleRetry
                          : undefined
                      }
                    />
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

          <ChatComposer
            input={input}
            onInputChange={(value) => {
              setInput(value);
              if (sendError) setSendError(null);
            }}
            composerNoteRefs={composerNoteRefs}
            composerCalendarRefs={composerCalendarRefs}
            onRemoveNoteRef={removeComposerNoteRef}
            onRemoveCalendarRef={removeComposerCalendarRef}
            onNoteClick={onNoteClick}
            streaming={streaming}
            chatModelReady={chatModelReady}
            canSend={canSend}
            onSend={() => void handleSend()}
            onStop={handleStop}
            composerMenu={composerMenu}
            composerFieldRef={composerFieldRef}
            composerInputRef={composerInputRef}
            onKeyDown={handleComposerKeyDown}
            sendError={sendError}
          />
        </>
      )}
    </div>
  );
});

ChatSidebar.displayName = "ChatSidebar";
