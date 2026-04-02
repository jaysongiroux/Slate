# AI Note Creation & Editing with Streaming

**Date:** 2026-03-24
**Status:** Approved

## Overview

Add the ability for the AI to create and edit notes, with content streamed progressively so the user can watch it being written in real-time — both in a chat preview and in the note editor itself.

## Approach

**Tool-initiated inner LLM streaming.** The new tools (`create_note`, `edit_note`) receive instructions (not raw content). When invoked, they make a separate streaming LLM call to generate the note content token by token. Events are pushed directly to the gRPC Subject (bypassing the LangGraph stream loop). CRDT updates are batched and applied periodically so the editor stays in sync.

## Design Decisions

- **AI edits flow through CRDT (Yjs):** The AI acts as another sync client (`clientId: "ai-writer"`), so edits are merge-safe and the editor picks them up through the normal `PullDocumentEvents` sync path.
- **Dual display:** Content streams in both the chat sidebar (as a live preview card) and the note editor simultaneously. Chat gets tokens from the gRPC stream; the editor gets CRDT updates via normal sync.
- **Cancel keeps partial content:** If the user cancels mid-stream, whatever was written stays in the note. No rollback.
- **Full rewrite vs targeted edits:** Both modes output the full note (simplifies CRDT handling). The difference is in the prompt — targeted mode instructs the LLM to preserve unchanged content.
- **AI picks title/path by default,** but respects explicit user instructions when given.
- **Single Y.Doc instance per tool execution:** Avoids the duplicate-content problem of calling `bootstrapFromMarkdown` repeatedly (which creates separate Yjs documents with different clientIDs that merge as duplicated content).

## Stream Event Types

Current events: `token`, `tool_call`, `done`.

New events:

| Event | Fields | Purpose |
|-------|--------|---------|
| `note_create_start` | `documentId`, `title`, `path` | A new note is being created — frontend opens it in the editor |
| `note_edit_start` | `documentId`, `title` | An existing note is being edited — frontend navigates to it |
| `note_delta` | `documentId`, `content` | A chunk of streaming content (displayed in chat preview) |
| `note_done` | `documentId`, `error?` | Note writing is complete. If `error` is set, writing failed (partial content is preserved). |

Updated `StreamEvent` type:

```typescript
export interface StreamEvent {
  type: "token" | "tool_call" | "done"
      | "note_create_start" | "note_edit_start" | "note_delta" | "note_done";
  content?: string;
  toolName?: string;
  documentId?: string;
  title?: string;
  path?: string;
  error?: string;
}
```

Note: The backend `StreamEvent` does not include `"error"` — that type exists only on the frontend `SendMessageEvent` and is synthesized by the Electron gRPC error handler, not emitted by the backend.

## Event Delivery — Direct Subject Push

Tools in LangGraph return a result string and do not yield streaming events. The LangGraph `ToolNode` does not emit `messages`-mode stream chunks (only the `agent` node does, because it runs an LLM). This means a queue-drain approach inside the `for await` loop would block until the tool completes — defeating streaming.

**Solution:** Pass a direct emitter callback from the controller to the tools. The controller creates the gRPC `Subject`, then passes `(event) => subject.next(event)` through `streamResponse()` into the tool closures. Tools push note events directly to the Subject, bypassing the LangGraph stream loop entirely.

```typescript
// ai.controller.ts — SendMessage
const subject = new Subject<any>();
(async () => {
  const stream = this.agentService.streamResponse(
    principal.userId,
    payload.conversationId,
    payload.content,
    (event) => subject.next(event),  // direct emitter for note events
  );
  for await (const event of stream) {
    subject.next(event);
  }
  subject.complete();
})();

// agent.service.ts — streamResponse signature
async *streamResponse(
  userId: string,
  conversationId: string,
  userMessage: string,
  emitNoteEvent: (event: StreamEvent) => void,  // new parameter
): AsyncGenerator<StreamEvent>
```

The main generator still yields `token`, `tool_call`, and `done` events from the LangGraph stream. Note events (`note_create_start`, `note_delta`, etc.) bypass the generator and go directly to the Subject. This ensures note deltas arrive in real-time during tool execution.

## CRDT Strategy — Single Y.Doc with Incremental Updates

Calling `CrdtService.bootstrapFromMarkdown()` repeatedly creates a new `Y.Doc` each time with a new auto-generated Yjs `clientID`. When these independent states are merged via `pushDocumentUpdate`, Yjs unions the content from both documents — producing duplicated/garbled text.

**Solution:** Maintain a single `Y.Doc` instance for the lifetime of each tool execution. On each intermediate push, update the doc's content within a Yjs transaction and encode only the incremental delta.

**New method: `CrdtService.replaceContent(ydoc, markdown)`**

```typescript
replaceContent(ydoc: Y.Doc, markdown: string): {
  update: Buffer;     // incremental update (delta since last state)
  markdown: string;   // materialized markdown
  plainText: string;  // materialized plain text
} {
  const stateVectorBefore = Y.encodeStateVector(ydoc);
  const pmNode = slateMarkdownParser.parse(markdown);
  const json = pmNode ? pmNode.toJSON() : { type: "doc", content: [{ type: "paragraph" }] };

  ydoc.transact(() => {
    const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
    // Clear existing content
    while (fragment.length > 0) fragment.delete(0, 1);
    // Re-populate from parsed markdown using y-prosemirror internals
    // (populate the fragment from ProseMirror JSON)
  });

  const update = Buffer.from(Y.encodeStateAsUpdate(ydoc, stateVectorBefore));
  const materialized = this.materialize(Buffer.from(Y.encodeStateAsUpdate(ydoc)));
  return { update, markdown: materialized.markdown, plainText: materialized.plainText };
}
```

**Tool CRDT flow:**

1. **create_note:** Create a new `Y.Doc`. On each intermediate push (~500 chars or 500ms debounce), call `replaceContent(ydoc, accumulatedMarkdown)` then `pushDocumentUpdate(... crdtUpdate: update)`.
2. **edit_note:** Load existing CRDT state into a `Y.Doc` via `Y.applyUpdate(ydoc, existingState)`. Same intermediate push pattern.
3. Final push at completion ensures the full content is persisted.

Because all updates come from the same `Y.Doc` instance (same Yjs clientID), `pushDocumentUpdate`'s `mergeUpdate` correctly applies each delta as an incremental change — no duplication.

**Rate limiting:** Intermediate CRDT pushes are throttled to at most one every 500ms, in addition to the ~500 char threshold. This prevents excessive DB writes during fast token generation.

## `create_note` Tool

**Schema:**

```typescript
z.object({
  title: z.string().describe("Title for the new note"),
  path: z.string().optional().describe("File path (e.g., 'projects/design.md'). Inferred from title if omitted."),
  instructions: z.string().describe("What to write in the note — be specific about content, structure, and tone"),
})
```

**Execution flow:**

1. Generate a document ID (UUID)
2. Derive path from title if not provided (slugify title + `.md`)
3. Emit `note_create_start` with `{documentId, title, path}` via `emitNoteEvent`
4. Create a new `Y.Doc` instance (retained for the tool's lifetime)
5. Make a streaming LLM call with a focused writing prompt:
   - System: "You are a note writer. Write markdown content for a note titled '{title}'. Follow the user's instructions precisely. Output only the note content, no preamble."
   - User: the `instructions` string
6. As tokens arrive:
   - Accumulate into a markdown buffer
   - Emit `note_delta` with each chunk via `emitNoteEvent` (for chat preview)
   - On throttled intervals (~500 chars / 500ms): call `CrdtService.replaceContent(ydoc, accumulatedMarkdown)`, then `DocumentsService.pushDocumentUpdate()` with `clientId: "ai-writer"` and `principal: { userId }` and `crdtUpdate: update`
7. Final `replaceContent` + `pushDocumentUpdate` with complete content
8. Emit `note_done` via `emitNoteEvent`
9. Return tool result: `"Created note: {title} (id: {documentId})"`

## `edit_note` Tool

**Schema:**

```typescript
z.object({
  documentId: z.string().describe("ID of the note to edit"),
  instructions: z.string().describe("What changes to make — be specific"),
  mode: z.enum(["rewrite", "targeted"]).optional()
    .describe("'rewrite' replaces entire content, 'targeted' modifies specific sections. Defaults to 'targeted' for notes over 500 words, 'rewrite' otherwise."),
})
```

**Execution flow:**

1. Fetch the existing note (markdown + CRDT state) from the database
2. If note not found or doesn't belong to user, return error string (no `note_edit_start` emitted)
3. Emit `note_edit_start` with `{documentId, title}` via `emitNoteEvent`
4. Create a `Y.Doc` and apply existing CRDT state: `Y.applyUpdate(ydoc, existingCrdtState)`
5. Determine mode: use provided mode, or auto-select (targeted for >500 words, rewrite otherwise)
6. Make a streaming LLM call:
   - **Rewrite mode:** "Rewrite this note following the instructions. Output the complete updated note.\n\nCurrent note:\n{markdown}\n\nInstructions: {instructions}"
   - **Targeted mode:** "Edit this note following the instructions. Output the complete note with your changes applied. Preserve all content that doesn't need to change.\n\nCurrent note:\n{markdown}\n\nInstructions: {instructions}"
7. Stream tokens → `note_delta` events + throttled `replaceContent` + `pushDocumentUpdate` (same as create)
8. Final push, emit `note_done`
9. Return: `"Edited note: {title} (id: {documentId})"`

Both modes output the full note — the mode difference is in the prompt (restructure freely vs preserve unchanged content).

**Document ID discovery:** The AI discovers document IDs through existing search/list tools (`vector_search`, `title_search`, `list_recent`, `full_text_search`, `get_note`) before calling `edit_note`. The system prompt instructs the AI to first find the note, then edit it.

## Proto Changes (`slate.proto`)

Extend `SendMessageResponse`:

```protobuf
message SendMessageResponse {
  string type = 1;
  optional string content = 2;
  optional string tool_name = 3;
  optional string document_id = 4;  // new
  optional string title = 5;         // new
  optional string path = 6;          // new
  optional string error = 7;         // new — used by note_done on failure
}
```

New fields use `optional string` for consistency with existing fields and to distinguish "not set" from empty string. The `@grpc/proto-loader` with `keepCase: false` auto-converts snake_case to camelCase (`document_id` → `documentId`).

No new RPCs — everything flows through the existing `SendMessage` stream.

## Frontend Changes

### `api.ts`

Extend `SendMessageEvent`:

```typescript
export interface SendMessageEvent {
  type: 'token' | 'tool_call' | 'done' | 'error'
      | 'note_create_start' | 'note_edit_start' | 'note_delta' | 'note_done';
  content?: string;
  toolName?: string;
  documentId?: string;
  title?: string;
  path?: string;
  error?: string;
}
```

Note: `'error'` exists only on the frontend type — it's synthesized by the Electron gRPC error handler in `backend-client.mjs`, not emitted by the backend.

### `ChatSidebar.tsx`

New state for tracking an active note write:

```typescript
const [activeNoteWrite, setActiveNoteWrite] = useState<{
  documentId: string;
  title: string;
  content: string;
} | null>(null);
```

In the `onEvent` callback:

- `note_create_start` / `note_edit_start`: set `activeNoteWrite`, call `onNoteClick(documentId)` to open the note in the editor
- `note_delta`: append content to `activeNoteWrite` (chat preview updates)
- `note_done`: clear `activeNoteWrite`, call `api.syncNow()` to ensure editor has final state. If `event.error` is set, show error in the chat.

Render a "Writing note: {title}" card in the chat showing streaming content as a live markdown preview when `activeNoteWrite` is set.

### Editor

No changes needed. The AI pushes CRDT updates via `pushDocumentUpdate` with `clientId: "ai-writer"`. The editor's existing sync loop picks them up via `PullDocumentEvents`.

**Concurrent editing:** If the user edits the note in the editor while the AI is also writing, CRDT merge handles this correctly — that is the purpose of using Yjs. Both sets of changes are preserved.

### `backend-client.mjs`

No changes needed. It forwards all gRPC stream response fields transparently. New fields (`documentId`, `title`, `path`, `error`) pass through automatically since `@grpc/proto-loader` with `keepCase: false` converts them to camelCase.

## Backend Changes

### `agent.service.ts`

- Add `emitNoteEvent` parameter to `streamResponse()` signature
- Inject `CrdtService` and `DocumentsService` (needed by tool closures)
- Pass `emitNoteEvent`, `CrdtService`, `DocumentsService`, and `chatModel` to new tool constructors
- No changes to the stream loop itself — note events bypass it via direct Subject push

### `ai.controller.ts`

- In `sendMessage()`, pass `(event) => subject.next(event)` as the `emitNoteEvent` callback to `streamResponse()`

### `ai.module.ts`

- Import `DocumentsModule` (which must now export `CrdtService`)
- This provides `DocumentsService` and `CrdtService` for injection into `AgentService`

### `documents.module.ts`

- Add `CrdtService` to the `exports` array (currently only `DocumentsService` is exported)

### `crdt.service.ts`

- Add `replaceContent(ydoc, markdown)` method as described in the CRDT Strategy section

### System Prompt

Update `buildSystemMessages()` to inform the AI about create/edit capabilities:

> "You can also create new notes and edit existing ones. When a user asks you to write, draft, create, or modify a note, use the create_note or edit_note tools. For create_note, provide a clear title and detailed instructions about what to write. For edit_note, first use search tools to find the note's document ID, then provide the ID and precise instructions for the changes. Prefer targeted edits for long notes and full rewrites for short ones."

## Cancellation

1. gRPC stream is cancelled (existing behavior)
2. Inner LLM streaming call aborts via `AbortSignal` passed to the tool
3. Partial content is already persisted via intermediate CRDT pushes — the note keeps whatever was written
4. No cleanup needed — the note exists with partial content, user can continue editing manually

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Inner LLM call fails | Tool catches error, does final CRDT push of accumulated content, emits `note_done` with `error` field, returns error as tool result |
| Note not found (edit) | Tool returns error string immediately. No `note_edit_start` emitted. Agent relays error to user. |
| CRDT push fails | Log warning, continue streaming. Final push retries once. Worst case: chat has preview content but editor didn't update — next sync picks it up. |
| User has no write permission | Tool checks ownership before starting. Returns error string. |

## Concurrency Notes

- **One active AI operation at a time.** The system must prevent multiple concurrent AI streaming operations. The frontend already disables the composer while `streaming` is true. Additionally, the backend should reject `SendMessage` calls if the user already has an active stream in progress (return `FAILED_PRECONDITION`). This is enforced via a per-user in-memory lock in `AgentService` (e.g., a `Map<userId, boolean>`).
- **`clientId: "ai-writer"` is shared** across all AI write operations. This means all AI writes share one `deviceCursor` entry. This is intentional — the AI is treated as a single logical device. The cursor's `lastServerSeq` advances normally and does not interfere with other devices' sync.

## Files Changed

| File | Change |
|------|--------|
| `packages/proto/slate.proto` | Add `document_id`, `title`, `path`, `error` fields (optional) to `SendMessageResponse` |
| `apps/core-backend/src/ai/agent.service.ts` | Add `emitNoteEvent` param, inject CrdtService/DocumentsService, pass to tool constructors |
| `apps/core-backend/src/ai/ai.controller.ts` | Pass direct emitter callback `(event) => subject.next(event)` to `streamResponse()` |
| `apps/core-backend/src/ai/tools/create-note.tool.ts` | **New** — create_note tool with inner LLM streaming + CRDT pushes |
| `apps/core-backend/src/ai/tools/edit-note.tool.ts` | **New** — edit_note tool with inner LLM streaming + CRDT pushes |
| `apps/core-backend/src/ai/ai.module.ts` | Import `DocumentsModule` to provide CrdtService/DocumentsService |
| `apps/core-backend/src/documents/documents.module.ts` | Add `CrdtService` to exports |
| `apps/core-backend/src/documents/crdt.service.ts` | Add `replaceContent(ydoc, markdown)` method |
| `apps/desktop/src/lib/api.ts` | Extend `SendMessageEvent` type with new event types and fields |
| `apps/desktop/src/components/ChatSidebar.tsx` | Handle note_* events, render writing preview card, trigger sync on completion |
