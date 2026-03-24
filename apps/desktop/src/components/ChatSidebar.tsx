import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ConversationDrawer } from './ConversationDrawer';
import * as api from '../lib/api';
import type { ConversationResponse, SendMessageEvent } from '../lib/api';

interface ChatSidebarProps {
  onSwitchToNotes: () => void;
  onNoteClick: (documentId: string) => void;
}

interface MessageItem {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export function ChatSidebar({ onSwitchToNotes, onNoteClick }: ChatSidebarProps) {
  const [conversations, setConversations] = useState<ConversationResponse[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try {
      const list = await api.listConversations();
      setConversations(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatus]);

  const handleNewConversation = async () => {
    try {
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      setMessages([]);
      setToolStatus(null);
      setDrawerOpen(false);
    } catch {
      // ignore
    }
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    setToolStatus(null);
    try {
      const msgs = await api.getConversationMessages(id);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
      );
    } catch {
      setMessages([]);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
        setToolStatus(null);
      }
    } catch {
      // ignore
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);
    setToolStatus(null);

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const conv = await api.createConversation();
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        conversationId = conv.id;
      } catch {
        setStreaming(false);
        return;
      }
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'USER', content: text },
      { id: assistantMsgId, role: 'ASSISTANT', content: '' },
    ]);

    try {
      await api.sendMessage(conversationId, text, (event: SendMessageEvent) => {
        if (event.type === 'token' && event.content) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + event.content }
                : m
            )
          );
        } else if (event.type === 'tool_call' && event.toolName) {
          setToolStatus(`Using tool: ${event.toolName}…`);
        } else if (event.type === 'done') {
          setToolStatus(null);
        }
      });
    } catch {
      // ignore
    } finally {
      setStreaming(false);
      setToolStatus(null);
      // Refresh conversation list so counts/titles update
      loadConversations();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Conversation Drawer */}
      <ConversationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onSwitchToNotes}
          aria-label="Switch to notes"
          style={{
            background: 'none',
            border: 'none',
            color: '#a0a0c0',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          📄
        </button>

        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#e0e0f0',
            letterSpacing: '0.01em',
          }}
        >
          AI Chat
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open conversations"
            style={{
              background: 'none',
              border: 'none',
              color: '#a0a0c0',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            ☰
          </button>
          <button
            type="button"
            onClick={handleNewConversation}
            aria-label="New conversation"
            style={{
              background: 'none',
              border: 'none',
              color: '#a0a0c0',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#5a5a8a',
              fontSize: 13,
              textAlign: 'center',
              padding: '0 16px',
            }}
          >
            Ask a question about your notes
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                content={msg.content}
                onNoteClick={onNoteClick}
              />
            ))}
            {toolStatus && (
              <div
                style={{
                  fontSize: 11,
                  color: '#6c63ff',
                  padding: '4px 8px',
                  fontStyle: 'italic',
                  opacity: 0.8,
                }}
              >
                {toolStatus}
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '8px 10px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…"
          disabled={streaming}
          style={{
            flex: 1,
            background: '#0d0d1a',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#e0e0f0',
            fontSize: 12,
            padding: '7px 10px',
            outline: 'none',
            opacity: streaming ? 0.6 : 1,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          aria-label="Send message"
          style={{
            background: '#6c63ff',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: streaming || !input.trim() ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
