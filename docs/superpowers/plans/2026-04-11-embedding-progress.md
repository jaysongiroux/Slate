# Embedding Progress Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polling-based progress bar to the AI settings tab so users see embedding progress, and guard against stale jobs when config changes mid-batch.

**Architecture:** New `GET /api/ai/embed/status` endpoint returns document counts. Frontend polls every 2s while AI tab is visible. `embedding-batch` worker snapshots config at start and bails if it changes mid-loop. The PUT config response now includes `embeddingModelOrProviderChanged` so the frontend knows to start polling.

**Tech Stack:** Fastify, Prisma, pg-boss, React, Tailwind CSS, Electron IPC

---

### Task 1: Backend — Add embed status endpoint

**Files:**

- Modify: `apps/core-backend/src/routes/ai.ts:177-188`

- [ ] **Step 1: Add the status endpoint**

Add before the existing `POST /api/ai/embed` route:

```typescript
// ── Embedding status ──

fastify.get("/api/ai/embed/status", auth, async (request) => {
  const userId = request.user!.userId;
  const total = await fastify.prisma.document.count({
    where: { userId, deleted: false },
  });
  const embedded = await fastify.prisma.document.count({
    where: { userId, deleted: false, embedded: true },
  });
  return { total, embedded, remaining: total - embedded };
});
```

- [ ] **Step 2: Add `embeddingModelOrProviderChanged` to PUT response**

The `maskConfig` function and the PUT handler need to pass this flag through so the frontend knows when to start polling. Modify the `maskConfig` call in the PUT handler:

```typescript
return maskConfig(config, { chatStreamingConfigChanged, embeddingModelOrProviderChanged });
```

Update the `maskConfig` function signature and spread:

```typescript
function maskConfig(
  config: any,
  options?: { chatStreamingConfigChanged?: boolean; embeddingModelOrProviderChanged?: boolean },
) {
  return {
    embeddingProvider: config?.embeddingProvider ?? undefined,
    embeddingModel: config?.embeddingModel ?? undefined,
    embeddingEndpoint: config?.embeddingEndpoint ?? undefined,
    hasEmbeddingApiKey: !!config?.embeddingApiKey,
    chatProvider: config?.chatProvider ?? undefined,
    chatModel: config?.chatModel ?? undefined,
    chatEndpoint: config?.chatEndpoint ?? undefined,
    hasChatApiKey: !!config?.chatApiKey,
    ...(options?.chatStreamingConfigChanged !== undefined
      ? { chatStreamingConfigChanged: options.chatStreamingConfigChanged }
      : {}),
    ...(options?.embeddingModelOrProviderChanged !== undefined
      ? { embeddingModelOrProviderChanged: options.embeddingModelOrProviderChanged }
      : {}),
  };
}
```

- [ ] **Step 3: Verify manually**

Run: `cd apps/core-backend && npx tsc --noEmit`
Expected: No type errors

---

### Task 2: Backend — Stale job guard in embedding-batch worker

**Files:**

- Modify: `apps/core-backend/src/jobs/job-handlers.service.ts:44-60`

- [ ] **Step 1: Add config snapshot and staleness check to embedding-batch worker**

Replace the `embedding-batch` worker registration with:

```typescript
await this.jobs.registerWorker("embedding-batch", async (job) => {
  const userId =
    job.data && typeof (job.data as { userId?: string }).userId === "string"
      ? (job.data as { userId: string }).userId
      : undefined;
  if (!userId) return;

  // Snapshot config at job start
  const initialConfig = await this.prisma.aiConfig.findUnique({
    where: { userId },
    select: { embeddingProvider: true, embeddingModel: true },
  });
  if (!initialConfig?.embeddingModel || !initialConfig?.embeddingProvider) {
    this.logger.info(`embedding-batch: no embedding config for user ${userId}, skipping`);
    return;
  }

  this.logger.info(`embedding-batch job for user ${userId}`);
  const batchSize = 50;
  const maxBatches = 500;
  for (let i = 0; i < maxBatches; i++) {
    // Check for config staleness before each batch
    if (i > 0) {
      const currentConfig = await this.prisma.aiConfig.findUnique({
        where: { userId },
        select: { embeddingProvider: true, embeddingModel: true },
      });
      if (
        currentConfig?.embeddingProvider !== initialConfig.embeddingProvider ||
        currentConfig?.embeddingModel !== initialConfig.embeddingModel
      ) {
        this.logger.info(`embedding-batch: config changed for user ${userId}, stopping stale job`);
        return;
      }
    }

    const n = await this.embeddingService.processUnembeddedDocuments(batchSize);
    if (n < batchSize) {
      break;
    }
  }
});
```

- [ ] **Step 2: Verify**

Run: `cd apps/core-backend && npx tsc --noEmit`
Expected: No type errors

**Note on `embedding-cron` and `embedding-process` workers:** These call `processUnembeddedDocuments(50)` once — a single short batch. If config changes mid-batch, the worst case is a few documents embedded with the old model before the config-change handler deletes all chunks and resets `embedded: false`. The `embedding-batch` worker is the only one with a long-running loop (up to 500 iterations) where staleness matters. No guard needed for cron/process.

---

### Task 3: IPC plumbing — Wire embed status through Electron

**Files:**

- Modify: `apps/desktop/electron/services/http-client.mjs` (after `triggerEmbedding`)
- Modify: `apps/desktop/electron/main.mjs` (after `desktop:triggerEmbedding` handler)
- Modify: `apps/desktop/electron/preload.mjs` (after `triggerEmbedding` line)

- [ ] **Step 1: Add HTTP client method**

In `apps/desktop/electron/services/http-client.mjs`, add after the `triggerEmbedding()` method:

```javascript
async getEmbedStatus() {
  return this.get("/api/ai/embed/status");
}
```

- [ ] **Step 2: Add IPC handler in main process**

In `apps/desktop/electron/main.mjs`, add after the `desktop:triggerEmbedding` handler:

```javascript
ipcMain.handle("desktop:getEmbedStatus", () => httpClient.getEmbedStatus());
```

- [ ] **Step 3: Expose in preload**

In `apps/desktop/electron/preload.mjs`, add after the `triggerEmbedding` line:

```javascript
getEmbedStatus: () => invoke("desktop:getEmbedStatus"),
```

---

### Task 4: Frontend types and API wrapper

**Files:**

- Modify: `apps/desktop/src/lib/api/ipc-core.ts`
- Modify: `apps/desktop/src/lib/api/ai-api.ts`

- [ ] **Step 1: Add types and DesktopApi method**

In `apps/desktop/src/lib/api/ipc-core.ts`, add the response type after `UpdateAiConfigRequest`:

```typescript
export interface EmbedStatusResponse {
  total: number;
  embedded: number;
  remaining: number;
}
```

Add `embeddingModelOrProviderChanged` to `AiConfigResponse`:

```typescript
export interface AiConfigResponse {
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
  hasEmbeddingApiKey: boolean;
  chatProvider?: string;
  chatModel?: string;
  chatEndpoint?: string;
  hasChatApiKey: boolean;
  /** Present after UpdateAiConfig: true when chat model/provider/endpoint/key changed. */
  chatStreamingConfigChanged?: boolean;
  /** Present after UpdateAiConfig: true when embedding model/provider changed. */
  embeddingModelOrProviderChanged?: boolean;
}
```

Add to the `DesktopApi` interface, after `triggerEmbedding`:

```typescript
getEmbedStatus(): Promise<EmbedStatusResponse>;
```

Add to the `browserFallback` object, after the `triggerEmbedding` stub:

```typescript
async getEmbedStatus() {
  return { total: 0, embedded: 0, remaining: 0 };
},
```

- [ ] **Step 2: Add API wrapper function**

In `apps/desktop/src/lib/api/ai-api.ts`, add after `triggerEmbedding`:

```typescript
export function getEmbedStatus() {
  return desktopApi().getEmbedStatus();
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No type errors

---

### Task 5: Frontend — Progress bar in AiSettingsSection

**Files:**

- Modify: `apps/desktop/src/components/AiSettingsSection.tsx`

- [ ] **Step 1: Add imports and state**

Add `useRef` and `useCallback` to the React import. Add `getEmbedStatus` to the API import. Add `EmbedStatusResponse` to the type import:

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import { getAiConfig, updateAiConfig, triggerEmbedding, getEmbedStatus } from "../lib/api";
import type { AiConfigResponse, UpdateAiConfigRequest, EmbedStatusResponse } from "../lib/api";
```

- [ ] **Step 2: Add polling state and logic inside the component**

Inside `AiSettingsSection`, after the existing `useState` declarations, add:

```typescript
const [embedProgress, setEmbedProgress] = useState<EmbedStatusResponse | null>(null);
const [progressVisible, setProgressVisible] = useState(false);
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

const stopPolling = useCallback(() => {
  if (pollRef.current) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }
}, []);

const startPolling = useCallback(() => {
  stopPolling();
  const poll = async () => {
    try {
      const status = await getEmbedStatus();
      setEmbedProgress(status);
      if (status.remaining === 0) {
        stopPolling();
        // Animate out, then clear
        setTimeout(() => {
          setProgressVisible(false);
          setTimeout(() => setEmbedProgress(null), 250);
        }, 500);
        return;
      }
      setProgressVisible(true);
    } catch {
      // Polling failure is non-fatal — just skip this tick
    }
  };
  void poll();
  pollRef.current = setInterval(() => void poll(), 2000);
}, [stopPolling]);
```

- [ ] **Step 3: Add initial status check on mount**

Add after the existing `useEffect` that loads AI config:

```typescript
useEffect(() => {
  if (!isAuthenticated) return;
  void getEmbedStatus().then((status) => {
    if (status.remaining > 0) {
      setEmbedProgress(status);
      setProgressVisible(true);
      startPolling();
    }
  });
  return () => stopPolling();
}, [isAuthenticated, startPolling, stopPolling]);
```

- [ ] **Step 4: Update handleSave to start polling on embedding config change**

In the `handleSave` function, after `const updated = await updateAiConfig(payload);`, add:

```typescript
if ((updated as any).embeddingModelOrProviderChanged) {
  setEmbedProgress({ total: 0, embedded: 0, remaining: 0 });
  setProgressVisible(true);
  startPolling();
}
```

Note: We cast to `any` because `embeddingModelOrProviderChanged` is optional on `AiConfigResponse` and only present after updates. Alternatively, we already added it to the type in Task 4, so it can be accessed directly as `updated.embeddingModelOrProviderChanged`.

Actually, since we added it to the type in Task 4, just use:

```typescript
if (updated.embeddingModelOrProviderChanged) {
  setEmbedProgress({ total: 0, embedded: 0, remaining: 0 });
  setProgressVisible(true);
  startPolling();
}
```

- [ ] **Step 5: Update handleReEmbed to start polling**

Replace the existing `handleReEmbed` function:

```typescript
async function handleReEmbed() {
  const confirmed = confirm("Re-index all documents? This may take a while.");
  if (!confirmed) return;
  setEmbedding(true);
  setEmbedStatus("");
  try {
    await triggerEmbedding();
    setProgressVisible(true);
    startPolling();
  } catch (err) {
    setEmbedStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setEmbedding(false);
  }
}
```

- [ ] **Step 6: Disable Re-scan button during embedding**

Update the Re-scan button's `disabled` prop:

```tsx
<Button
  variant="secondary"
  onClick={() => void handleReEmbed()}
  disabled={embedding || (embedProgress !== null && embedProgress.remaining > 0)}
>
  {embedding ? "Starting..." : "Re-scan documents"}
</Button>
```

- [ ] **Step 7: Add progress bar UI**

Replace the `embedStatus` display block with the progress bar. Put this after the `saveStatus` block and before the closing `</div>`:

```tsx
{
  /* Embedding progress */
}
<div
  className={cn(
    "overflow-hidden transition-all duration-200 ease-in-out",
    progressVisible && embedProgress ? "max-h-20 opacity-100" : "max-h-0 opacity-0",
  )}
>
  {embedProgress && (
    <div className="flex flex-col gap-1">
      <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-in-out"
          style={{
            width:
              embedProgress.total > 0
                ? `${(embedProgress.embedded / embedProgress.total) * 100}%`
                : "0%",
          }}
        />
      </div>
      <div className="text-[0.75rem] text-muted">
        Embedding {embedProgress.embedded} / {embedProgress.total} documents...
      </div>
    </div>
  )}
</div>;

{
  embedStatus && (
    <div
      className={cn(
        "rounded-lg px-3 py-2 text-[0.84rem]",
        embedStatus.startsWith("Error")
          ? "bg-[rgba(255,146,136,0.12)] text-danger"
          : "bg-[rgba(40,200,64,0.12)] text-[#6fcf7f]",
      )}
    >
      {embedStatus}
    </div>
  );
}
```

Remove the old `embedStatus` success message block that was below the buttons (keep only the error case, which is now handled above). The old `Re-embedding started. N document(s) queued.` message is replaced by the progress bar.

- [ ] **Step 8: Verify**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No type errors
