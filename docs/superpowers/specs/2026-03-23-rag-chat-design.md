# RAG Chat Feature — Design Spec

## Overview

Add AI-powered chat to Slate that lets users ask questions about their notes using Retrieval-Augmented Generation (RAG). The feature runs on the core backend (online only, requires login), supports multiple LLM providers, and provides a chat interface in the desktop app's left sidebar.

## Constraints & Decisions

- **Online only** — requires authentication to the core backend
- **Per-user isolation** — vectors, conversations, and configs are scoped per user; no cross-user data leakage
- **Multi-provider** — OpenAI, Anthropic, Ollama, OpenAI-compatible (LM Studio)
- **Separate embedding and chat models** — users configure each independently; changing embedding model triggers full re-embed
- **Notes only** — attachments excluded for now, but the chunking service is designed to be extensible
- **LangChain + LangGraph** — agent orchestration, tool routing, and streaming within NestJS
- **pgvector** — vector storage in existing PostgreSQL, no new infrastructure

## Data Model

### AiConfig (per-user AI settings)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK, cuid() — matches existing codebase convention |
| userId | string | FK → User, unique |
| embeddingProvider | enum | OPENAI, OLLAMA, OPENAI_COMPATIBLE |
| embeddingModel | string | e.g. "text-embedding-3-small" |
| embeddingEndpoint | string? | Base URL for Ollama/LM Studio |
| embeddingApiKey | bytes? | AES-256-GCM encrypted |
| chatProvider | enum | OPENAI, ANTHROPIC, OLLAMA, OPENAI_COMPATIBLE |
| chatModel | string | e.g. "gpt-4o", "claude-sonnet-4-20250514" |
| chatEndpoint | string? | Base URL for Ollama/LM Studio |
| chatApiKey | bytes? | AES-256-GCM encrypted |
| createdAt | datetime | |
| updatedAt | datetime | |

**Note:** Anthropic does not offer an embedding API, so ANTHROPIC is only available as a chat provider, not an embedding provider.

### DocumentChunk (embedding chunks)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK, cuid() |
| documentId | string | FK → Document |
| userId | string | FK → User (denormalized for query performance) |
| chunkIndex | int | Order within document |
| content | text | Chunk text |
| heading | string? | Nearest heading for retrieval context |
| embedding | vector(1536) | pgvector column, fixed at 1536 dimensions. Models producing different dimensions are padded/truncated or the column is recreated on model change. Since all chunks are deleted and re-embedded when the embedding model changes, the column dimension can be altered via migration at that time. |
| embeddingModel | string | Model used to generate this embedding |
| createdAt | datetime | |

### Document additions

| Field | Type | Notes |
|-------|------|-------|
| embedded | boolean | Default false. Set to false on edit, true after chunking + embedding |

### Conversation (chat history)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK, cuid() |
| userId | string | FK → User |
| title | string? | Auto-generated from first message |
| summary | text? | Running summary of older messages for context management |
| createdAt | datetime | |
| updatedAt | datetime | |

### Message (chat messages)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK, cuid() |
| conversationId | string | FK → Conversation |
| role | enum | USER, ASSISTANT |
| content | text | |
| metadata | json? | Tool calls, sources referenced |
| createdAt | datetime | |

## Backend Architecture

### New NestJS Module: AiModule

**AiConfigService**
- CRUD for per-user AI settings
- Handles AES-256-GCM encryption/decryption of API keys using `AI_ENCRYPTION_KEY` env variable
- Encryption happens at the service layer — both gRPC (desktop app) and AdminJS (admin backend) go through this service
- Validates provider connectivity on save (test ping)
- On embedding model change: deletes all user's chunks, sets all documents to `embedded = false`

**ModelProviderService**
- Resolves a user's AiConfig into LangChain-compatible model instances (ChatOpenAI, ChatAnthropic, ChatOllama, OpenAIEmbeddings, etc.)
- Caches instances per user, invalidates on config change

**ChunkingService**
- Takes a markdown document, splits by heading structure (h1, h2, h3)
- If a section exceeds ~1000 tokens, splits further by paragraph
- Short documents (< 500 tokens) stay as a single chunk
- Each chunk retains its nearest heading for context
- Designed to be extensible for attachments in the future

**EmbeddingService**
- Takes chunks, calls the user's configured embedding model, stores vectors in DocumentChunk
- Handles batching to respect API rate limits

**AgentService**
- LangGraph StateGraph with ReAct-style agent loop
- Conversation memory loaded from Message table (not LangChain's built-in memory)
- System prompt instructs the agent it's a note-taking assistant with access to the user's personal notes
- Streams events (tool calls, token chunks) via LangGraph's streaming API

**ConversationService**
- CRUD for conversations and messages
- Auto-generates conversation title from first user message
- Manages conversation summary: regenerates when messages fall outside the sliding window

### LangGraph Agent Tools

1. **`vector_search(query: string, limit?: number)`** — embeds the query using user's embedding model, queries pgvector with cosine similarity, returns top-k chunks with document title/path and heading context
2. **`title_search(query: string)`** — SQL ILIKE search on document title and path, returns matching documents with metadata
3. **`get_note(documentId: string)`** — retrieves full markdown content of a specific note
4. **`list_recent(limit?: number, sort?: 'created' | 'updated')`** — returns documents sorted by date
5. **`full_text_search(query: string)`** — uses existing Postgres tsvector search, complements semantic search for exact keyword matches

### Conversation Context Management

As conversations grow, the full history cannot be sent to the LLM (especially with smaller local models).

- **Running summary**: when the conversation exceeds a sliding window of recent messages, a summary of older messages is generated and stored in the `summary` field on the Conversation model
- **Context sent to LLM**: system prompt → conversation summary (if older messages exist) → last N messages in full
- **Update trigger**: summary regenerated each time messages fall outside the sliding window

### Embedding Pipeline

**Cron job (pg-boss):**
- Interval configured via `EMBEDDING_CRON_INTERVAL` env variable, default `0 */2 * * *` (every 2 hours)
- Query: documents where `embedded = false` for users who have an AiConfig with embedding configured
- Processes in batches (e.g., 50 documents per run)
- For each document: chunk → generate embeddings → upsert DocumentChunk rows → set `embedded = true`

**Re-embed (triggered from settings dialog):**
- Calls `TriggerEmbedding` gRPC method
- Sets `embedded = false` on all user's documents
- Enqueues an immediate pg-boss job for that user (skips waiting for cron)

### gRPC API Additions

- `CreateAiConfig` / `UpdateAiConfig` / `GetAiConfig`
- `CreateConversation` / `ListConversations` / `DeleteConversation`
- `SendMessage` (server-streaming for token-by-token response)
- `TriggerEmbedding` (for the re-embed button)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_ENCRYPTION_KEY` | (required) | AES-256-GCM key for encrypting API keys |
| `EMBEDDING_CRON_INTERVAL` | `0 */2 * * *` | pg-boss cron schedule for embedding job |

## Desktop App — Chat UI

### Sidebar Transformation

The left sidebar transforms into a full chat interface. A toggle switches between the notes file tree and chat mode.

**Chat mode header:**
- Notes icon (switch back to file tree)
- "AI Chat" title
- Hamburger icon (opens conversation history drawer)
- + button (new conversation)

**Chat area:**
- Messages displayed as bubbles (user right-aligned, assistant left-aligned)
- Assistant responses can include source chips — clickable note references that open the note in the editor
- Streaming: tokens appear in real-time as the LangGraph agent responds
- Tool usage indicators shown during agent processing (e.g., "Searching notes...")

**Input area:**
- Text input with send button at the bottom of the sidebar

### Conversation History Drawer

- Slides over the sidebar when hamburger icon is clicked
- Searchable list of past conversations
- Each entry shows: title, message count, timestamp
- Active conversation highlighted
- "New Conversation" button at bottom
- Clicking a conversation loads it and closes the drawer

### Settings Dialog — AI Section

- **Embedding config**: provider dropdown, model input, endpoint input (shown for Ollama/OpenAI-compatible), API key input
- **Chat config**: same fields as embedding
- **Connection test button**: pings configured provider to validate connectivity
- **Re-embed button**: with confirmation dialog ("This will re-process all your notes")

### Provider Enum

| Value | Available For | Description |
|-------|---------------|-------------|
| `OPENAI` | Embedding + Chat | Standard OpenAI API |
| `ANTHROPIC` | Chat only | Anthropic API (no embedding API available) |
| `OLLAMA` | Embedding + Chat | Ollama local endpoint (no API key needed) |
| `OPENAI_COMPATIBLE` | Embedding + Chat | LM Studio and others using OpenAI-compatible API format |

## Admin Backend (AdminJS)

- AiConfig visible in AdminJS for admin management
- API keys displayed masked (last 4 characters only)
- Admin can clear keys but not view full values
- All writes go through AiConfigService — encryption enforced at the service layer

## Future Extensibility

- **Attachments**: ChunkingService designed to accept different content types; PDF/image processing can be added as new chunking strategies
- **Microservice extraction**: if embedding/chat workload grows, AiModule can be extracted to a separate service
