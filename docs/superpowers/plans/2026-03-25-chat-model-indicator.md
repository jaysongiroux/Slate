# Chat Model Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the active LLM model as a subtle label in the chat sidebar header.

**Architecture:** A pure helper function maps raw provider/model strings to friendly display names. A `<span>` in the header renders it, conditionally visible when a chat model is configured.

**Tech Stack:** React 19, TypeScript, CSS

**Spec:** `docs/superpowers/specs/2026-03-25-chat-model-indicator-design.md`

---

### Task 1: Add the friendly display name helper

**Files:**
- Modify: `apps/desktop/src/components/ChatSidebar.tsx` (add helper function before the component, ~line 38)

- [ ] **Step 1: Add `getChatModelDisplayName` helper above the component**

```typescript
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

  // Pass through raw model string for Ollama / OpenAI-compatible / unknown
  return m;
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `getChatModelDisplayName`

---

### Task 2: Add the CSS class for the model label

**Files:**
- Modify: `apps/desktop/src/styles.css` (add after `.chat-sidebar-root > .sidebar-heading` block, ~line 1393)

- [ ] **Step 1: Add `.chat-model-label` class**

```css
.chat-model-label {
  font-size: 0.72rem;
  color: var(--text-faint);
  letter-spacing: 0.01em;
  margin-left: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Note: `margin-left: 4px` rather than 6px because the parent `.sidebar-heading__title-group` already has `gap: 2px`, giving 6px total visual spacing.

---

### Task 3: Render the model label in the chat header

**Files:**
- Modify: `apps/desktop/src/components/ChatSidebar.tsx:553` (after the "Chat" title span)

- [ ] **Step 1: Add the label element**

After the existing line:
```tsx
<span className="sidebar-heading__title">Chat</span>
```

Add:
```tsx
{chatModelReady && aiConfig?.chatModel ? (
  <span className="chat-model-label">
    {getChatModelDisplayName(aiConfig.chatProvider, aiConfig.chatModel)}
  </span>
) : null}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Manual verification**

Run: `cd apps/desktop && npm run dev`

Verify:
- Label appears in chat header next to "Chat" title when a model is configured
- Label shows friendly name (e.g. "Claude Sonnet") for known models
- Label disappears when model is unconfigured
- Label truncates with ellipsis when sidebar is narrow
- Label updates when changing model in Settings
