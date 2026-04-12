# Note graph (Extensions) — design

## Problem

Users want an Obsidian-style **note relationship graph** without manual `[[links]]`. Relationships should come from **existing embedding infrastructure** (chunk vectors in Postgres), with a **per-user opt-in** under Settings, a **dedicated graph UI** in the desktop app, and **predictable rebuild** behavior aligned with embedding jobs and re-scan.

## Goals

1. **Settings → Extensions**: per-user toggle to enable the note graph feature (synced like other user settings).
2. **Gating**: enabling and using the feature requires **authentication** and a **reachable backend**; UI reflects disabled state with clear copy when not met.
3. **Desktop UX**:
   - **Icon rail**: show a graph entry **only when the extension is enabled**.
   - **Layout**: selecting the graph opens a **right panel only** (no left notes/calendar column for this mode).
   - **Hover**: show **note title** and **about two lines** of preview text.
   - **Click node**: **navigate to** that note in the editor.
4. **Edges**: **embedding-derived only** — no wiki links, no “why is this related” surfaced in the UI.
5. **Rebuild semantics**: **full recompute** for a user — delete all of that user’s similarity edges, then rebuild from current vectors.
6. **Triggers (combined)**:
   - **(A)** After embedding work for the user reaches a **fully embedded** state (`remaining === 0` in the same sense as `GET /api/ai/embed/status`), enqueue a graph rebuild job for that user (when the extension is enabled and embedding is configured).
   - **(C)** **Re-scan documents** (`POST /api/ai/embed`) **immediately deletes** all graph edges for that user, then follows the existing embedding queue flow; when the user is fully embedded again, **(A)** runs a full rebuild (so re-scan always ends in a fresh graph once embeddings catch up).

## Non-goals

- Explaining or ranking edge reasons in the UI.
- Explicit manual linking between notes.
- RxDB replication of edge rows in v1 (optional later); **fetch graph payload when the panel opens** is sufficient.
- Graph layout persistence, collaborative cursors, or real-time co-editing in the graph view.

---

## Context from the current codebase

- **Vectors** are stored on **`document_chunk.embedding`** (`vector(4096)`), not on `document`. `document.embedded` marks completion of the embed pipeline for that document.
- **`embedding-batch`** (`apps/core-backend/src/jobs/job-handlers.service.ts`) runs up to `maxBatches` iterations of `EmbeddingService.processUnembeddedDocuments(batchSize)`. That service currently selects unembedded documents across **all users** who have embedding config; graph triggers must still be **scoped by `userId`** using per-user counts.
- **Re-scan** today: `POST /api/ai/embed` sets `embedded: false` for all non-deleted docs for the user and enqueues `embedding-batch` (`apps/core-backend/src/routes/ai.ts`).

---

## Architecture

```text
[Desktop: Settings toggle] ──sync──► [Setting row or dedicated flag]
[Desktop: Graph panel open] ──HTTP──► [GET graph API]

[EmbeddingService.embedDocument] ──writes──► [document_chunk rows + vectors]
[embedding-batch job ends] ──if user fully embedded──► enqueue [note-graph-rebuild]
[POST /api/ai/embed] ──first──► DELETE all edges for user
                                 └──► existing embed queue

[note-graph-rebuild worker] ──► DELETE edges (user) + INSERT edges from vector logic
```

### New worker: `note-graph-rebuild`

- **Queue name**: `note-graph-rebuild` (exact name an implementation detail; use one consistent name in code).
- **Payload**: `{ userId: string }`.
- **Idempotency**: safe to run twice; outcome is delete-all + rebuild for that user.

**Enqueue when:**

1. End of **`embedding-batch`** for a given `userId` job: after the batch loop, if **extension enabled** for that user, **embedding provider/model configured**, and **no remaining unembedded documents** for that user (`total - embedded === 0` over non-deleted docs), enqueue `note-graph-rebuild` for that `userId`.
2. **Extension toggled on** while the user is already fully embedded: enqueue `note-graph-rebuild` once (so the graph appears without waiting for the next embed).
3. Do **not** enqueue (or no-op the worker) when the extension is **disabled** — saves CPU and avoids storing unused edges.

**Re-scan path:**

- At the start of **`POST /api/ai/embed`** (same handler or helper): `DELETE` all `document_similarity_edge` rows for `userId` so the graph is empty during re-embedding.
- When embeddings complete, trigger **(1)** as usual.

---

## Chunk embeddings → document–document similarity

Documents can have **multiple chunks**, each with a vector. The graph is **between documents**, not chunks.

**Recommended approach (v1):**

1. Restrict to documents where `deleted = false`, `embedded = true`, and the document has **at least one** chunk with a non-null `embedding`.
2. Compute a **single representative vector per document** as the **arithmetic mean (centroid)** of that document’s chunk vectors (pgvector / SQL or a short raw query). If a document has only one chunk, the centroid equals that chunk.
3. For each document **D**, find the **top K** other documents by **cosine similarity** (or `<->` with consistent ordering) between centroids, excluding self. **K** is a server-side constant (suggested default **10**), adjustable later without schema changes.
4. Emit **undirected** edges for the graph: for each unordered pair **(A, B)** that appears when taking top-K from **either** side, either:
   - **Merge rule (recommended)**: store an edge if **B** is in top-K of **A** **or** **A** is in top-K of **B** (union), with `score` = similarity under a fixed rule (e.g. max of the two directed scores, or the score from the lower-id document’s query to avoid ambiguity), **or**
   - **Simpler rule**: only edges from the directed top-K of each D (may duplicate reverse; renderer can dedupe).

**Storage convention:** one row per unordered pair: enforce `fromDocumentId < toDocumentId` and `UNIQUE (userId, fromDocumentId, toDocumentId)`.

**Performance note:** Implement as **per-document kNN** against **document centroids** (not O(n²) all-pairs over chunks). Use pgvector indexes appropriate to the table that holds centroids (either an inline temp table per job, a **materialized intermediate** in the job, or a small **`document_graph_centroid`** table updated whenever embeddings change — optional optimization in a follow-up).

**Edge cases:**

- **No chunks / missing vectors**: skip document in graph; if fewer than K neighbors exist, emit fewer edges.
- **Extension off**: worker returns immediately; optionally **delete all edges** for the user on toggle-off to reclaim space (recommended).

---

## Data model (Postgres / Prisma)

New model, e.g. **`DocumentSimilarityEdge`**:

| Column            | Type     | Notes |
|-------------------|----------|--------|
| `id`              | cuid     | Primary key |
| `userId`          | string   | Owner |
| `fromDocumentId`  | string   | Always `<` `toDocumentId` |
| `toDocumentId`    | string   | FK to `document` |
| `score`           | float    | Comparable ranking (document exact formula in implementation) |
| `createdAt`       | DateTime | Audit |

Indexes:

- `(userId)` for delete-all and fetch-by-user.
- `(userId, fromDocumentId)` / `(userId, toDocumentId)` if queries need neighborhood lookup (tune to chosen API shape).

**Cascade**: on document delete, remove edges touching that document (DB-level `ON DELETE CASCADE` from both FKs, or application delete — pick one; CASCADE is simpler).

---

## User preference: extension enabled

**Recommended:** reuse the existing **`Setting`** model (`key` / `value` JSON) with a stable key, e.g. **`extensions.noteGraphEnabled`**, boolean in `value`, replicated via existing settings replication (same pattern as other client-owned settings). Alternative: add a field on **`AiConfig`** if product prefers graph tied strictly to AI embedding — **not** required; settings key keeps Extensions decoupled from provider keys.

**Server-side read** for job enqueue: join or fetch this setting when deciding to enqueue `note-graph-rebuild`.

---

## API (authenticated)

Exact paths are implementation details; suggested shapes:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/graph` (or under `/api/notes/graph`) | Return `{ nodes: [...], edges: [...] }` for the current user. **404 or empty** if extension disabled. |
| `GET` | `/api/graph/node/:documentId/preview` (optional) | Short title + ~2 lines; **or** embed preview fields in `GET /api/graph` nodes to avoid N+1. |

**Node payload** (minimal): `id` (document id), `title`, `preview` (two lines plain text, server-truncated from `markdown` or first chunk text).

**Edge payload**: `{ source, target, score }` using document ids; renderer maps to nodes.

**Rate / size:** For very large vaults, document caps (max nodes, sampling) in a later iteration; v1 may return full graph if product accepts memory bounds.

---

## Desktop app

### Settings (`SettingsDialog`)

- New nav item: **Extensions** (or **Extensions** subsection containing the graph toggle).
- Toggle **Note graph** (label TBD) persisted through **settings replication** with the chosen key.
- If not authenticated or backend unreachable: **disable** toggle and show short helper text consistent with other server-dependent settings.

### Icon rail

- Register a **graph** icon **only when** `extensions.noteGraphEnabled === true` (and auth + backend as needed for consistency).

### Graph mode layout

- When the graph rail item is active: **hide or collapse the left column**; show **only the main chrome + right graph panel** (exact layout follows existing rail / panel patterns in `App.tsx`).

### Graph panel behavior

- On open: `GET` graph API; render force-directed (or similar) graph with **library choice** left to implementation plan.
- **Hover**: tooltip with **title** + **~2 lines** from API preview.
- **Click**: dispatch the same **open note** action used elsewhere (navigate to document id).

### Errors

- If API fails: inline error state in the panel; do not block the rest of the app.

---

## Testing (high level)

- **Unit / integration**: rebuild job with small fixture user — N docs, known vectors → expected edge set under fixed K.
- **API**: authenticated `GET` returns 403/404 when disabled; returns graph when enabled and edges exist.
- **Re-scan**: after handler runs, edges count for user is 0; after mocked “all embedded”, rebuild produces non-empty graph when configured.

---

## Security & privacy

- All graph endpoints **user-scoped**; never return another user’s edges or titles.
- Edges are derived from **content the user already stores** in the product; no extra PII channel.

---

## Implementation sequencing (non-binding)

1. Prisma migration + `note-graph-rebuild` worker + centroid/top-K logic + enqueue hooks from `embedding-batch` and re-scan.
2. Graph GET API.
3. Settings UI + settings key + gating.
4. Rail icon + right panel + graph renderer + hover/click behavior.

---

## Self-review checklist

- [x] No unresolved “TBD” for core triggers: **D** captured as re-scan edge delete + post-embed full rebuild when `remaining === 0`.
- [x] Chunk vs document embedding discrepancy **called out** and resolved via **centroid + top-K**.
- [x] `embedding-batch` / cross-user batch behavior noted; per-user **remaining** check is specified.
- [x] Non-goals explicit for v1 replication of edges.

---

## Approval

Design agreed in conversation on **2026-04-12** (user: “yes”). Next step: **writing-plans** skill → implementation plan with file-level tasks.
