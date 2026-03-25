import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from 'react';
import { ChevronLeft, List, MessageSquarePlus, X } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import * as api from '../lib/api';
import type { LocalNoteSummary } from '@slate/shared';
import type { AiConfigResponse, ConversationResponse, SendMessageEvent } from '../lib/api';
import {
  useComposerTriggerMenu,
  type ComposerTriggerMenuConfig,
} from '../hooks/useComposerTriggerMenu';

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
  const m = model?.trim() ?? '';
  if (!m) return '';

  const KNOWN: Record<string, string> = {
    'claude-sonnet-4-20250514': 'Claude Sonnet',
    'claude-haiku-4-5-20251001': 'Claude Haiku',
    'claude-opus-4-20250514': 'Claude Opus',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'o3-mini': 'o3 Mini',
  };

  if (KNOWN[m]) return KNOWN[m];

  // Pattern-based fallbacks for Anthropic models: "claude-sonnet-4-xxx" → "Claude Sonnet"
  const claudeMatch = m.match(/^claude-(\w+)/);
  if (claudeMatch) {
    return `Claude ${claudeMatch[1].charAt(0).toUpperCase()}${claudeMatch[1].slice(1)}`;
  }

  // GPT pattern: "gpt-5" → "GPT-5"
  if (m.startsWith('gpt-')) {
    return m.replace('gpt-', 'GPT-').replace(/-/g, ' ').replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // o-series pattern: "o4-mini" → "o4 Mini"
  if (/^o\d/.test(m)) {
    return m.replace(/-/g, ' ').replace(/ (\w)/g, (_, c) => ` ${c.toUpperCase()}`);
  }

  // Pass through raw model string for Ollama / OpenAI-compatible / unknown
  return m;
}

/** Markdown link label must not contain `]` (see ChatMessage NOTE_LINK_RE). */
function safeNoteLinkTitle(title: string): string {
  return title.replace(/\]/g, '');
}

interface MessageItem {
  id: string;
  role: 'USER' | 'ASSISTANT';
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
  const [input, setInput] = useState('');
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
  const streamTokenBufRef = useRef('');
  const streamTokenRafRef = useRef<number | null>(null);
  const streamAssistantMsgIdRef = useRef<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationSearchRef = useRef<HTMLInputElement>(null);
  const composerFieldRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const [conversationSearch, setConversationSearch] = useState('');
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
    window.addEventListener('slate-ai-config-changed', onCfg);
    return () => {
      window.removeEventListener('slate-ai-config-changed', onCfg);
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

  const chatModelReady = Boolean(
    aiConfig?.chatProvider?.trim() && aiConfig?.chatModel?.trim(),
  );

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
        const id =
          saved && list.some((c) => c.id === saved)
            ? saved
            : list[0]?.id ?? null;
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
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      const label = note.title || note.path.split('/').pop() || 'Untitled';
      return {
        id: `note-${note.id}`,
        label,
        description: note.path,
        keywords: [note.path, note.title, ...note.path.split('/').filter(Boolean)],
        insertText: '',
        execute: () => {
          addComposerNoteRef({ documentId: note.id, title: label });
        },
      };
    });
  }, [notes, addComposerNoteRef]);

  const adjustComposerSize = useCallback(() => {
    const ta = composerInputRef.current;
    if (!ta) return;

    ta.style.height = 'auto';
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
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
    ta.style.overflowX = 'hidden';
  }, []);

  useLayoutEffect(() => {
    adjustComposerSize();
  }, [input, adjustComposerSize]);

  useLayoutEffect(() => {
    const el = composerFieldRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => adjustComposerSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [adjustComposerSize]);

  const composerTriggerConfigs = useMemo<ComposerTriggerMenuConfig[]>(
    () => [
      {
        trigger: '/',
        items: [
          {
            id: 'reset',
            label: 'reset',
            description: 'Start a new conversation (clear context)',
            keywords: ['new', 'clear', 'context'],
            execute: () => {
              void handleNewConversation();
            },
          },
        ],
      },
      {
        trigger: '@',
        items: mentionMenuItems,
        emptyHint: 'No notes to mention',
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
      setConversationSearch('');
      return;
    }
    const t = window.setTimeout(() => conversationSearchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [conversationsOpen]);

  useEffect(() => {
    if (!conversationsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConversationsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conversationsOpen]);

  const filteredConversations = conversationSearch.trim()
    ? conversations.filter((c) =>
        (c.title ?? 'New Conversation').toLowerCase().includes(conversationSearch.toLowerCase()),
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
      .map(
        (n) =>
          ` [${safeNoteLinkTitle(n.title)}](note://${n.documentId})`,
      )
      .join('');
    const body =
      linkBlock && trimmed
        ? `${linkBlock} ${trimmed}`
        : linkBlock || trimmed;
    return body.trim();
  }, [input, composerNoteRefs]);

  const canSend =
    chatModelReady && !streaming && Boolean(buildOutgoingMessage());

  const handleSend = async () => {
    const text = buildOutgoingMessage();
    if (!text || streaming || !chatModelReady) return;

    setInput('');
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
    streamTokenBufRef.current = '';

    const flushPendingStreamTokens = () => {
      if (streamTokenRafRef.current != null) {
        cancelAnimationFrame(streamTokenRafRef.current);
        streamTokenRafRef.current = null;
      }
      const id = streamAssistantMsgIdRef.current;
      const chunk = streamTokenBufRef.current;
      streamTokenBufRef.current = '';
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
        streamTokenBufRef.current = '';
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
      { id: userMsgId, role: 'USER', content: text },
      { id: assistantMsgId, role: 'ASSISTANT', content: '' },
    ]);

    try {
      await api.sendMessage(conversationId, text, (event: SendMessageEvent) => {
        if (event.type === 'error') {
          streamTokenBufRef.current = '';
          if (streamTokenRafRef.current != null) {
            cancelAnimationFrame(streamTokenRafRef.current);
            streamTokenRafRef.current = null;
          }
          dropAssistantPlaceholder();
          setSendError(event.content?.trim() || 'Something went wrong.');
          return;
        }
        if (event.type === 'token' && event.content) {
          // Don't accumulate tokens while a note operation is active —
          // the writing preview card is the only visible indicator.
          if (!noteActiveRef.current) {
            queueStreamToken(event.content);
          }
        } else if (event.type === 'tool_call' && event.toolName) {
          if (event.toolName === 'create_note' || event.toolName === 'edit_note') {
            noteActiveRef.current = true;
          } else {
            setToolStatus(`Using tool: ${event.toolName}…`);
          }
        } else if (event.type === 'done') {
          flushPendingStreamTokens();
          setToolStatus(null);
        } else if (event.type === 'note_create_start' || event.type === 'note_edit_start') {
          setActiveNoteWrite({
            documentId: event.documentId!,
            title: event.title!,
            content: '',
          });
          api.syncNow().then(() => onOpenNoteInEditor(event.documentId!)).catch(() => {});
        } else if (event.type === 'note_delta' && event.content) {
          setActiveNoteWrite((prev) =>
            prev ? { ...prev, content: prev.content + event.content } : prev,
          );
          const now = Date.now();
          if (now - lastNoteSyncRef.current >= 800) {
            lastNoteSyncRef.current = now;
            api.syncNow().catch(() => {});
          }
        } else if (event.type === 'note_done') {
          noteActiveRef.current = false;
          if (event.error) {
            setSendError(`Note writing failed: ${event.error}`);
          }
          setActiveNoteWrite(null);
          api.syncNow().catch(() => {});
        }
      });
    } catch (err) {
      streamTokenBufRef.current = '';
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showTypingIndicator =
    streaming &&
    !toolStatus &&
    lastMessage?.role === 'ASSISTANT' &&
    lastMessage.content.length === 0;

  return (
    <div className="chat-sidebar-root">
      <div className="sidebar-heading">
        <div className="sidebar-heading__title-group">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="sidebar-heading__button"
                onClick={onBackToNotes}
                aria-label="Back to notes"
              >
                <ChevronLeft size={18} strokeWidth={2.25} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to notes</TooltipContent>
          </Tooltip>
          <span className="sidebar-heading__title">Chat</span>
          {chatModelReady && aiConfig?.chatModel ? (
            <span className="chat-model-label">
              {getChatModelDisplayName(aiConfig.chatProvider, aiConfig.chatModel)}
            </span>
          ) : null}
        </div>
        <div className="sidebar-heading__actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'sidebar-heading__button',
                  conversationsOpen && 'sidebar-heading__button--pressed',
                )}
                onClick={() => setConversationsOpen((o) => !o)}
                aria-label={conversationsOpen ? 'Back to chat' : 'Browse conversations'}
                aria-pressed={conversationsOpen}
              >
                <List size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {conversationsOpen ? 'Back to chat' : 'Browse and switch conversations'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="sidebar-heading__button"
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
        <nav
          className="chat-conversations"
          aria-label="Conversations"
        >
          <div className="chat-conversations__search-wrap">
            <input
              ref={conversationSearchRef}
              type="search"
              className="chat-conversations__search"
              placeholder="Search…"
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="chat-conversations__list">
            {filteredConversations.length === 0 ? (
              <div className="chat-conversations__empty">
                {conversationSearch.trim() ? 'No matches' : 'No conversations yet'}
              </div>
            ) : (
              <ul className="chat-conversations__ul">
                {filteredConversations.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  const title = conv.title ?? 'New Conversation';
                  return (
                    <li key={conv.id} className="chat-conversations__li">
                      <div
                        className={cn(
                          'chat-conversations__item',
                          isActive && 'chat-conversations__item--active',
                        )}
                      >
                        <button
                          type="button"
                          className="chat-conversations__item-select"
                          onClick={() => pickConversation(conv.id)}
                        >
                          <span className="chat-conversations__row-title">{title}</span>
                          <span className="chat-conversations__row-meta">
                            {conv.messageCount}{' '}
                            {conv.messageCount === 1 ? 'message' : 'messages'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="chat-conversations__item-delete"
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
          <div className="chat-conversations__footer">
            <button
              type="button"
              className="chat-conversations__new"
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
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.5,
                  fontSize: 13,
                  textAlign: 'center',
                  padding: '0 12px',
                }}
              >
                Ask a question about your notes
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={bulkLoadedIdsRef.current.has(msg.id) ? undefined : 'chat-msg-animated'}
                  >
                    <ChatMessage
                      role={msg.role}
                      content={msg.content}
                      onNoteClick={onNoteClick}
                    />
                  </div>
                ))}
                {toolStatus && (
                  <div className="chat-tool-status">{toolStatus}</div>
                )}
                {activeNoteWrite && (
                  <div className="chat-note-writing" aria-live="polite">
                    <div className="chat-note-writing__header">
                      Tool: Writing note: {activeNoteWrite.title}
                    </div>
                    <div className="chat-note-writing__preview">
                      {activeNoteWrite.content || '…'}
                    </div>
                  </div>
                )}
                {showTypingIndicator ? (
                  <div
                    className="chat-typing"
                    aria-live="polite"
                    aria-label="Assistant is typing"
                  >
                    <span className="chat-typing__dots" aria-hidden>
                      <span className="chat-typing__dot" />
                      <span className="chat-typing__dot" />
                      <span className="chat-typing__dot" />
                    </span>
                  </div>
                ) : null}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {sendError ? (
            <div className="chat-panel-banner chat-panel-banner--error" role="alert">
              {sendError}
            </div>
          ) : null}
          {!aiConfigLoading && !chatModelReady ? (
            <div className="chat-panel-banner chat-panel-banner--hint">
              Select a chat model in Settings to send messages.
            </div>
          ) : null}

          <div className="chat-composer">
            {composerMenu.menuVisible ? (
              <div
                className="chat-composer__menu"
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
                      'chat-composer__menu-item',
                      index === composerMenu.selectedIndex && 'chat-composer__menu-item--active',
                    )}
                    onMouseDown={composerMenu.onMenuItemMouseDown}
                    onMouseEnter={() => composerMenu.highlightItem(index)}
                    onClick={() => composerMenu.pickItem(index)}
                  >
                    <span className="chat-composer__menu-item-label">{item.label}</span>
                    {item.description ? (
                      <span className="chat-composer__menu-item-desc">{item.description}</span>
                    ) : null}
                  </button>
                ))}
                {composerMenu.filteredItems.length === 0 && composerMenu.emptyHint ? (
                  <div className="chat-composer__menu-empty" role="status">
                    {composerMenu.emptyHint}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="chat-composer__main">
              {composerNoteRefs.length > 0 ? (
                <div
                  className="chat-composer__attachments"
                  role="list"
                  aria-label="Notes referenced in this message"
                >
                  {composerNoteRefs.map((n) => (
                    <div
                      key={n.documentId}
                      className="chat-composer__attachment"
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="chat-composer__attachment-open"
                        onClick={() => onNoteClick(n.documentId)}
                      >
                        {n.title}
                      </button>
                      <button
                        type="button"
                        className="chat-composer__attachment-remove"
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
                  'chat-composer__field',
                  (streaming || !chatModelReady) && 'chat-composer__field--disabled',
                )}
              >
                <textarea
                  ref={composerInputRef}
                  className="chat-composer__input"
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
                      ? 'Ask anything… ( / commands · @ notes )'
                      : 'Configure a chat model in Settings…'
                  }
                  disabled={streaming || !chatModelReady}
                />
              </div>
            </div>
            <button
              type="button"
              className="chat-composer__send"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
});

ChatSidebar.displayName = "ChatSidebar";
