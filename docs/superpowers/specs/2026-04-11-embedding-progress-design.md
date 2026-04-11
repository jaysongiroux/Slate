# Embedding Progress Reporting & Stale Job Guard

## Problem

When a user changes their embedding config (model or provider) or manually triggers "Re-scan documents", all their documents are queued for re-embedding. Currently this is fire-and-forget — the frontend has no visibility into progress, and if the user changes config again mid-embedding, stale jobs continue processing with the old config.

## Goals

1. Report embedding progress to the desktop app via a polling endpoint
2. Guard against stale embedding jobs when config changes mid-batch
3. Show an animated progress bar in the AI settings tab

## Non-goals

- SSE/websocket-based progress (polling is sufficient given embedding speed)
- Per-document error reporting in the UI (errors stay in server logs)
- Progress reporting outside the settings dialog

---

## Backend

### Polling endpoint

**`GET /api/ai/embed/status`** (authenticated)

Returns document embedding counts for the authenticated user:

```json
{ "total": 42, "embedded": 38, "remaining": 4 }
```

Implementation: three counts from the `document` table filtered by `userId` and `deleted: false`.

- `total`: all non-deleted documents
- `embedded`: documents where `embedded = true`
- `remaining`: `total - embedded`

File: `apps/core-backend/src/routes/ai.ts`

### Stale job guard

In the `embedding-batch` worker (`apps/core-backend/src/jobs/job-handlers.service.ts`):

1. At the start of the job, read the user's current `embeddingProvider` and `embeddingModel` from `aiConfig` and store as a snapshot.
2. Before each batch iteration (the `for` loop that calls `processUnembeddedDocuments`), re-query the user's config.
3. If `embeddingProvider` or `embeddingModel` differs from the snapshot, log a message and exit the loop. The config change in `AiConfigService.upsertConfig()` already enqueued a fresh `embedding-batch` job with the new config.

Apply the same guard to `embedding-cron` and `embedding-process` workers. These call `processUnembeddedDocuments` which iterates across all users, so the guard is per-user inside `EmbeddingService.processUnembeddedDocuments()`:

- Before embedding each user's batch, snapshot their config.
- After processing each document, check if config changed. If so, skip remaining documents for that user.

### Files modified

| File                                                 | Change                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/core-backend/src/routes/ai.ts`                 | Add `GET /api/ai/embed/status` endpoint                             |
| `apps/core-backend/src/jobs/job-handlers.service.ts` | Add stale config check in `embedding-batch` worker loop             |
| `apps/core-backend/src/ai/embedding.service.ts`      | Add per-user config staleness check in `processUnembeddedDocuments` |

---

## Frontend

### IPC plumbing

Add `getEmbedStatus` through the existing IPC chain:

| Layer       | File                                             | Addition                                        |
| ----------- | ------------------------------------------------ | ----------------------------------------------- |
| HTTP client | `apps/desktop/electron/services/http-client.mjs` | `getEmbedStatus()` → `GET /api/ai/embed/status` |
| Preload     | `apps/desktop/electron/preload.mjs`              | Expose `getEmbedStatus` via context bridge      |
| IPC handler | `apps/desktop/electron/main.mjs`                 | `desktop:getEmbedStatus` handler                |
| API wrapper | `apps/desktop/src/lib/api/ai-api.ts`             | `getEmbedStatus()` function                     |
| Types       | `apps/desktop/src/lib/api/ipc-core.ts`           | `EmbedStatusResponse` type                      |

### Progress bar in AiSettingsSection

**File:** `apps/desktop/src/components/AiSettingsSection.tsx`

**State additions:**

- `embedProgress: { total: number; embedded: number; remaining: number } | null`
- Polling interval ref

**Behavior:**

1. **On mount:** Call `getEmbedStatus()` once. If `remaining > 0`, start polling and show progress bar immediately (handles reopening settings mid-embedding).
2. **After "Re-scan documents" click:** Start polling at 2-second intervals.
3. **After save that changes embedding config:** The `PUT /api/ai/config` response already includes `embeddingModelOrProviderChanged` — if true, start polling.
4. **Polling loop:** Every 2 seconds, call `getEmbedStatus()`. Update `embedProgress` state.
5. **When `remaining === 0`:** Stop polling, animate progress bar out, clear `embedProgress` after animation completes.
6. **On unmount / tab switch away from AI:** Clear polling interval.

**UI:**

Replace the current `embedStatus` text message with:

```
┌─────────────────────────────────────┐
│ ████████████████░░░░░░░░░░░░░░░░░░░ │  ← animated progress bar
│ Embedding 12 / 42 documents...      │  ← small muted text below
└─────────────────────────────────────┘
```

- Progress bar: standard bar with smooth `width` transition (CSS `transition: width 300ms ease`)
- Appear/disappear: fade + height animation (CSS `transition: opacity 200ms, max-height 200ms`)
- "Re-scan documents" button: disabled while `embedProgress !== null && embedProgress.remaining > 0`
- Error state: if polling fails, show error text in place of progress (existing error styling)

### Animation details

- **Bar enter:** `opacity 0 → 1`, `max-height 0 → auto` over 200ms
- **Bar width:** `transition: width 300ms ease` — smoothly grows as documents complete
- **Bar exit:** `opacity 1 → 0`, `max-height → 0` over 200ms, then clear state

Use Tailwind classes + inline style for the dynamic width. The `transition` classes handle the animation without needing a library.

---

## Flow diagrams

### Re-scan flow

```
User clicks "Re-scan documents"
  → POST /api/ai/embed
  → Backend: marks all docs embedded=false, enqueues embedding-batch
  → Frontend: starts polling GET /api/ai/embed/status every 2s
  → Progress bar appears (animated in)
  → Worker processes batches of 50
  → Frontend polls, updates bar width + "Embedding N / M documents..."
  → Worker finishes (remaining = 0)
  → Frontend stops polling, animates bar out
```

### Config change mid-embedding flow

```
Embedding in progress (batch worker running)
  → User changes embedding model and saves
  → PUT /api/ai/config
  → AiConfigService: deletes chunks, marks docs embedded=false, enqueues NEW embedding-batch
  → Worker (old job): next iteration detects config mismatch, exits loop
  → Worker (new job): picks up, processes with new config
  → Frontend: polling continues uninterrupted, progress bar resets to 0/N
```

---

## Testing

### Backend

- `GET /api/ai/embed/status` returns correct counts (0 remaining when all embedded, N remaining after marking unembedded)
- Stale job guard: mock config change mid-batch, verify worker exits loop

### Frontend

- Progress bar appears when `remaining > 0` on mount
- Polling starts after re-scan click
- Button disabled during embedding
- Progress bar disappears when complete
- Polling stops on unmount
