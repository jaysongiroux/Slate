import { useState } from "react";
import type { ConversationResponse } from "../lib/api";

interface ConversationDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationResponse[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function ConversationDrawer({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: ConversationDrawerProps) {
  const [search, setSearch] = useState("");

  if (!open) return null;

  const filtered = search.trim()
    ? conversations.filter((c) =>
        (c.title ?? "New Conversation").toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 10,
        backgroundColor: "#111128",
        boxShadow: "2px 0 12px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#e0e0f0",
            letterSpacing: "0.01em",
          }}
        >
          Conversations
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close conversations drawer"
          style={{
            background: "none",
            border: "none",
            color: "#a0a0c0",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: "2px 4px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>

      {/* Search */}
      <div
        style={{
          padding: "8px 10px",
          flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <input
          type="text"
          placeholder="Search conversations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "#e0e0f0",
            fontSize: 12,
            padding: "6px 10px",
            outline: "none",
          }}
        />
      </div>

      {/* Conversation list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: "16px 14px",
              fontSize: 12,
              color: "#6060a0",
              textAlign: "center",
            }}
          >
            No conversations found
          </div>
        )}
        {filtered.map((conv) => {
          const isActive = conv.id === activeConversationId;
          const title = conv.title ?? "New Conversation";
          return (
            <div
              key={conv.id}
              onClick={() => {
                onSelectConversation(conv.id);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 14px",
                cursor: "pointer",
                backgroundColor: isActive ? "#2a2a4a" : "transparent",
                borderLeft: isActive ? "3px solid #6c63ff" : "3px solid transparent",
                transition: "background-color 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = "rgba(255,255,255,0.04)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
                }
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: isActive ? "#e8e8ff" : "#c0c0e0",
                    fontWeight: isActive ? 500 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#5a5a8a",
                    marginTop: 2,
                  }}
                >
                  {conv.messageCount} {conv.messageCount === 1 ? "message" : "messages"}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Delete conversation: ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conv.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#5a5a8a",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "2px 4px",
                  marginLeft: 6,
                  borderRadius: 4,
                  flexShrink: 0,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#e05050";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#5a5a8a";
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* New Conversation button */}
      <div
        style={{
          padding: "10px 12px",
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <button
          type="button"
          onClick={onNewConversation}
          style={{
            width: "100%",
            background: "#6c63ff",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 12px",
            cursor: "pointer",
            textAlign: "center",
            transition: "background-color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c73ff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6c63ff";
          }}
        >
          New Conversation
        </button>
      </div>
    </div>
  );
}
