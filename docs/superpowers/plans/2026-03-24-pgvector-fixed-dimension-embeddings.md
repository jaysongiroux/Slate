# pgvector fixed max dimension (multi-provider embeddings) — Implementation Plan

> **For agentic workers:** Use @superpowers/subagent-driven-development or @superpowers/executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store embeddings from OpenAI, Ollama, and OpenAI-compatible providers in a single `pgvector` column by using a fixed maximum dimension (4096) and zero-padding shorter vectors, while keeping search comparable only within the same `embeddingModel`.

**Architecture:** Postgres `document_chunk.embedding` becomes `vector(4096)`. All inserts pad vectors to 4096. Vector search pads the query vector the same way and filters rows with `dc."embeddingModel" = $currentUserModel` so different semantic spaces are never mixed. No separate migration file: edit the existing init migration and reset DB (non-deployed product).

**Tech Stack:** PostgreSQL + `pgvector`, Prisma (`Unsupported` type), NestJS core-backend, LangChain `Embeddings`.

---

## File map (create / modify)

| File | Responsibility |
|------|----------------|
| `packages/server-db/prisma/migrations/20260323225517_init/migration.sql` | `vector(1536)` → `vector(4096)` on `document_chunk` |
| `packages/server-db/prisma/schema.prisma` | `Unsupported("vector(4096)")` on `DocumentChunk.embedding` |
| `apps/core-backend/src/ai/embedding-dimensions.ts` *(new)* | `EMBEDDING_VECTOR_DIMENSIONS`, `padEmbeddingToMax()`, validation |
| `apps/core-backend/src/ai/embedding-dimensions.spec.ts` *(new)* | Unit tests for padding / oversize |
| `apps/core-backend/src/ai/embedding.service.ts` | Pad each chunk vector before `$executeRaw` insert |
| `apps/core-backend/src/ai/embedding.service.spec.ts` | Adjust mocks/expectations for padded dimensions or assert helper usage |
| `apps/core-backend/src/ai/tools/vector-search.tool.ts` | Pad query vector; filter `embeddingModel`; prefer `Prisma.$queryRaw` over `Unsafe` |
| `apps/core-backend/src/ai/tools/vector-search.tool.spec.ts` | New param, padded vectors in SQL, WHERE clause |
| `apps/core-backend/src/ai/agent.service.ts` | Pass configured `embeddingModel` string into `createVectorSearchTool` |

---

### Task 1: Embedding dimension helper + tests

**Files:**
- Create: `apps/core-backend/src/ai/embedding-dimensions.ts`
- Create: `apps/core-backend/src/ai/embedding-dimensions.spec.ts`

- [ ] **Step 1: Add failing tests** for `padEmbeddingToMax` / constant `EMBEDDING_VECTOR_DIMENSIONS = 4096`:
  - already length 4096 → unchanged reference or copy
  - length 1536 → length 4096, trailing entries `0`
  - length 0 → throw or reject (edge case: define behavior — recommend throw)
  - length 4097 → throw with clear message

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/core-backend && npm test -- --testPathPattern=embedding-dimensions.spec`

- [ ] **Step 3: Implement** `embedding-dimensions.ts` exporting:
  - `export const EMBEDDING_VECTOR_DIMENSIONS = 4096`
  - `export function padEmbeddingToMax(values: number[]): number[]`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** (optional) `test+feat: embedding dimension padding helper`

---

### Task 2: Database schema + Prisma

**Files:**
- Modify: `packages/server-db/prisma/migrations/20260323225517_init/migration.sql` (line with `"embedding" vector(1536)`)
- Modify: `packages/server-db/prisma/schema.prisma` (`DocumentChunk.embedding`)

- [ ] **Step 1:** In `migration.sql`, change to `"embedding" vector(4096),`

- [ ] **Step 2:** In `schema.prisma`, change to `Unsupported("vector(4096)")?`

- [ ] **Step 3:** Regenerate client

Run: `npm run prisma:generate --workspace @slate/server-db`

- [ ] **Step 4:** Reset local DB (project convention: `migrate reset` / Docker volume / `make` target — use whatever this repo documents)

- [ ] **Step 5: Commit** `chore(db): document_chunk embedding vector(4096)`

---

### Task 3: EmbeddingService writes padded vectors

**Files:**
- Modify: `apps/core-backend/src/ai/embedding.service.ts`
- Modify: `apps/core-backend/src/ai/embedding.service.spec.ts`

- [ ] **Step 1:** Import `padEmbeddingToMax` (and optionally `EMBEDDING_VECTOR_DIMENSIONS` for explicit `::vector(4096)` cast in SQL if needed).

- [ ] **Step 2:** In `embedDocument`, after obtaining each `vectors[i]`, assign `const padded = padEmbeddingToMax(vector)` and build `vectorStr` from `padded`.

- [ ] **Step 3:** Ensure SQL cast matches column (e.g. `... ${vectorStr}::vector(4096)` if Postgres requires explicit dim).

- [ ] **Step 4:** Update `embedding.service.spec.ts`:
  - Either mock `padEmbeddingToMax` via jest.mock, **or**
  - Use vectors of length 4096 in mocks when asserting `$executeRaw` string content.

- [ ] **Step 5:** Run `npm test -- --testPathPattern=embedding.service.spec` — expect PASS

- [ ] **Step 6: Commit** `fix(ai): pad embeddings to fixed pgvector width`

---

### Task 4: Vector search — pad query + filter by model + safer SQL

**Files:**
- Modify: `apps/core-backend/src/ai/tools/vector-search.tool.ts`
- Modify: `apps/core-backend/src/ai/tools/vector-search.tool.spec.ts`
- Modify: `apps/core-backend/src/ai/agent.service.ts`

- [ ] **Step 1:** Change `createVectorSearchTool` signature to accept **`embeddingModelId: string`** (exact value stored in `document_chunk.embeddingModel`).

- [ ] **Step 2:** After `embedQuery`, `padEmbeddingToMax` on the result; build literal or parameterized vector for pgvector.

- [ ] **Step 3:** Replace `$queryRawUnsafe` with **`prisma.$queryRaw`** using `Prisma.sql` / `Prisma.join` so `userId`, `limit`, and `embeddingModelId` are bound parameters. Vector literal: pgvector typically needs a string literal `[...]` — use `Prisma.raw` only for the bracket list built from **numeric** array (no user text in the vector), or pass as string after validating numeric. Document the chosen pattern in a one-line comment.

- [ ] **Step 4:** Add `AND dc."embeddingModel" = ${embeddingModelId}` (parameterized) to WHERE.

- [ ] **Step 5:** In `agent.service.ts`, when building tools:
  - If `embeddingModel` is non-null, load `embeddingModel` **string** from config (e.g. `await this.modelProvider` extension **or** `AiConfigService.getConfig(userId)` once — avoid N+1 if trivial).
  - Call `createVectorSearchTool(this.prisma, embeddingModel, userId, config.embeddingModel)`.

  Suggested minimal approach: in `streamResponse`, `const config = await this.aiConfigService.getConfig(userId)` only when `embeddingModel` is non-null, pass `config!.embeddingModel!`.

  *Note:* `AgentService` needs `AiConfigService` injected if not already present.

- [ ] **Step 6:** Update all tests in `vector-search.tool.spec.ts` for new arity and SQL shape.

- [ ] **Step 7:** Run `npm test -- --testPathPattern=vector-search` — expect PASS

- [ ] **Step 8: Commit** `fix(ai): vector search uses padded dims and embeddingModel filter`

---

### Task 5: Verification (manual + automated)

- [ ] **Step 1:** `npm run lint` / `npm test` in `apps/core-backend` (full suite if feasible).

- [ ] **Step 2:** Manual: configure Ollama embedding model that returns 2560 dims; run rescan; confirm no Prisma `22000` dimension error; run chat with vector search and confirm hits.

- [ ] **Step 3:** Manual: OpenAI `text-embedding-3-small` (1536) still embeds and searches.

---

## Out of scope (explicit)

- New Prisma migration file (edit init only per product decision).
- Anthropic embedding provider (still throws in `ModelProviderService` until implemented).
- HNSW / IVFFlat index on `embedding` (optional future performance task).
- Backfill scripts for production (not needed pre-deploy).

## Risks / notes

- **Future model &gt; 4096 dims:** requires new `vector(N)` migration and constant bump.
- **Mixed chunks without filter:** mitigated by `embeddingModel` WHERE; changing user model without re-embed can leave stale chunks — existing `AiConfigService` behavior may already clear chunks on model change; verify still correct.

---

## Plan review

Optional: run plan-document-reviewer subagent with this file path + link to prior design discussion (multi-dimension fix) before execution.
