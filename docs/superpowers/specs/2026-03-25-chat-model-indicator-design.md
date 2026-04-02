# Chat Model Indicator

Display the active LLM model as a subtle label in the chat sidebar header.

## Overview

Add a small, faint text label next to the "Chat" title in the sidebar heading that shows the friendly name of the currently configured chat model (e.g. "Claude Sonnet", "GPT-4o"). The label matches existing design tokens and blends into the header without adding visual clutter.

## Behaviour

- **Visible** when `chatModelReady` is true (provider and model both configured).
- **Hidden** when no chat model is configured (the existing "Select a chat model" banner handles that state).
- **Reactive**: updates automatically when `aiConfig` changes via the existing `slate-ai-config-changed` event listener already in `ChatSidebar`.

## Friendly Name Mapping

A `getChatModelDisplayName(provider, model)` helper converts raw config values to clean display names.

### Known models (exact match)

| Raw model ID | Display name |
|---|---|
| `claude-sonnet-4-20250514` | Claude Sonnet |
| `claude-haiku-4-5-20251001` | Claude Haiku |
| `claude-opus-4-20250514` | Claude Opus |
| `gpt-4o` | GPT-4o |
| `gpt-4o-mini` | GPT-4o Mini |
| `gpt-4-turbo` | GPT-4 Turbo |
| `o3-mini` | o3 Mini |

### Pattern-based fallbacks

| Pattern | Display name |
|---|---|
| Starts with `claude-` | Extract family: "Claude" + capitalised variant (e.g. `claude-sonnet-4-xxx` → "Claude Sonnet") |
| Starts with `gpt-` | Uppercase: e.g. `gpt-5` → "GPT-5" |
| Starts with `o1` / `o3` / `o4` | Pass through capitalised: e.g. `o3-mini` → "o3 Mini" |

### Unknown models

Fall back to the raw model string as-is (e.g. `llama3.1`, `mistral`, `qwen3:8b`). These are already recognisable names from Ollama/OpenAI-compatible providers and don't need transformation.

## Placement

Inside the existing `.sidebar-heading__title-group` div, after the "Chat" `<span>`:

```
[‹] Chat  Claude Sonnet                [☰] [＋]
```

The label sits inline, separated by a small gap, and is visually subordinate to the "Chat" title.

## Styling

New CSS class: `.chat-model-label`

| Property | Value | Rationale |
|---|---|---|
| `font-size` | `0.72rem` | Matches existing small-caption scale |
| `color` | `var(--text-faint)` | Same as sidebar heading buttons — visible but unobtrusive |
| `letter-spacing` | `0.01em` | Slightly tighter than heading |
| `margin-left` | `6px` | Breathing room from "Chat" title |
| `white-space` | `nowrap` | Prevent wrapping on narrow sidebars |
| `overflow` | `hidden` | Truncate gracefully |
| `text-overflow` | `ellipsis` | Show ellipsis when truncated |

## Files Changed

1. **`apps/desktop/src/components/ChatSidebar.tsx`**
   - Add `getChatModelDisplayName(provider, model)` helper (top of file or inline)
   - Add `<span className="chat-model-label">` after the "Chat" title span, conditionally rendered when `chatModelReady`

2. **`apps/desktop/src/styles.css`**
   - Add `.chat-model-label` class (~8 lines)

## Testing

- Verify label appears with each known provider/model combo from presets
- Verify label shows raw model string for unknown/custom models
- Verify label disappears when model is unconfigured
- Verify label truncates with ellipsis when sidebar is at minimum width (240px)
- Verify label updates live when changing model in settings
