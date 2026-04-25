<p align="center">
  <img src="docs/assets/logo.png" alt="Slate" width="120" />
</p>

<h1 align="center">Slate</h1>

<p align="center">
  Local-first notes for desktop, with optional self-hosted sync, AI chat, calendars, diagrams, and integrations.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#screenshots">Screenshots</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#deployment">Deployment</a> &bull;
  <a href="#configuration">Configuration</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/jaysongiroux/slate?style=flat-square" alt="Release" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

## Features

**Desktop notes** - Electron desktop app with React, Vite, RxDB, and a local workspace. You can use Slate without creating an account or running a backend.

**Rich Markdown editing** - Novel/Tiptap editor with Markdown import/export, slash commands, tables, task lists, syntax-highlighted code blocks, Mermaid code blocks, table of contents blocks, image uploads, and attachment handling.

**Optional backend sync** - Fastify backend syncs notes, folders, settings, diagrams, and attachments when you connect the desktop app to a self-hosted server.

**AI chat** - Backend-powered assistant with note search, recent-note lookup, create/edit note tools, vector search, calendar tools, Home Assistant tools, MCP tool access, and provider support for Anthropic, OpenAI, Ollama, and OpenAI-compatible endpoints.

**Search and graph** - Full-text note search plus optional embedding-backed similarity graph using PostgreSQL and pgvector.

**Calendar** - Google Calendar OAuth, ICS subscriptions, event CRUD, attendee search, calendar colors, and daily-note workflows.

**Diagrams and checklists** - Dedicated diagram workspace, Mermaid rendering, and checklist views derived from task items.

**Integrations** - Optional Linkwarden, Jira, GitHub/GitLab forge, Home Assistant, and MCP server panels.

**Admin and auth** - Admin UI/API for setup, users, storage settings, calendar settings, OIDC providers, and password-auth controls. User auth supports password login, TOTP, refresh tokens, and OIDC.

**Packaging and releases** - Electron Builder targets macOS, Windows, and Linux. Manual GitHub release workflow builds desktop artifacts and publishes a `core-backend` Docker image to GHCR.

---

## Screenshots

<p align="center">
  <img src="docs/assets/image.png" alt="Markdown editor with note tree" width="800" />
  <br />
  <em>Editor with hierarchical note tree</em>
</p>

<p align="center">
  <img src="docs/assets/chat.png" alt="AI chat sidebar" width="800" />
  <br />
  <em>AI chat sidebar with note tools</em>
</p>

<p align="center">
  <img src="docs/assets/settings.png" alt="Settings dialog" width="800" />
  <br />
  <em>Settings for workspace, server, AI, calendar, auth, and extensions</em>
</p>

<p align="center">
  <img src="docs/assets/admin.png" alt="Admin dashboard" width="800" />
  <br />
  <em>Admin dashboard for instance management</em>
</p>

---

## Architecture

Slate is an npm workspace monorepo:

```text
slate/
├── apps/
│   ├── desktop/           Electron + React + Vite desktop client
│   └── core-backend/      Fastify REST backend for auth, sync, AI, search, and integrations
├── packages/
│   ├── server-db/         Prisma schema, migrations, and generated client entrypoint
│   └── shared/            Shared TypeScript types and Markdown/Tiptap utilities
├── docker-compose.yml     Local PostgreSQL, backend, and MinIO services
└── Makefile               Common development commands
```

### Tech Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Desktop   | Electron 35, React 19, Vite, TypeScript, RxDB  |
| Editor    | Novel, Tiptap, ProseMirror, Mermaid, lowlight  |
| Backend   | Fastify 5, Prisma, JWT, AdminJS                |
| Database  | PostgreSQL 16 with pgvector                    |
| AI        | LangChain/LangGraph, Anthropic, OpenAI, Ollama |
| Jobs      | pg-boss                                        |
| Storage   | Filesystem or S3-compatible storage            |
| Packaging | Electron Builder, Docker, GitHub Actions       |

---

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+
- Docker, for local PostgreSQL and optional backend services

### Desktop Only

Use this when you only want local notes.

```bash
npm install
npm run dev:desktop
```

Or:

```bash
make install
make desktop-up
```

### Full Stack

Use this when you want backend auth, sync, AI, graph, calendar, admin, and integrations.

1. Install dependencies:

   ```bash
   make install
   ```

2. Copy backend env:

   ```bash
   cp apps/core-backend/.env.example apps/core-backend/.env
   ```

3. Start PostgreSQL:

   ```bash
   make db-up
   ```

4. Generate Prisma client and apply migrations:

   ```bash
   make db-prisma-generate
   make db-migrate-deploy
   ```

5. Start backend:

   ```bash
   make core-dev
   ```

6. Start desktop app in another terminal:

   ```bash
   make desktop-up
   ```

7. In Slate, open Settings, set the backend endpoint to `http://localhost:4000`, then sign in or complete initial setup.

### Tests

Create the test database once:

```bash
docker compose exec -T postgres psql -U slate -d slate -c 'CREATE DATABASE slate_test OWNER slate;'
```

Then run:

```bash
make core-test
make desktop-test
npm run test --workspace @slate/shared
```

For type checks:

```bash
make core-lint
make desktop-lint
```

---

## Deployment

### Docker Compose

`docker-compose.yml` defines:

| Service      | Port       | Purpose                               |
| ------------ | ---------- | ------------------------------------- |
| postgres     | 5435       | PostgreSQL 16 with pgvector           |
| core-backend | 4000       | REST API, admin UI, auth, sync, AI    |
| minio        | 9000, 9001 | Optional S3-compatible object storage |

For local backend development:

```bash
cp apps/core-backend/.env.example apps/core-backend/.env
make db-up
make db-migrate-deploy
make core-dev
```

To run backend in Docker:

```bash
cp apps/core-backend/.env.example apps/core-backend/.env
make db-up
make db-migrate-deploy
make stack-up
make stack-logs
```

Stop services:

```bash
make stack-down
```

### Desktop Packaging

```bash
make desktop-build
make desktop-package
```

Outputs are written under `apps/desktop/dist/`:

- macOS: `.dmg` and `.zip`
- Windows: `.exe` NSIS installer
- Linux: `.AppImage`

### CI and Releases

CI runs on pushes to `main` and on pull requests:

- Backend integration tests against PostgreSQL
- Desktop type check
- Desktop node tests
- Desktop production build

Releases are manual through GitHub Actions. The release workflow bumps patch version, tags the commit, builds/pushes `ghcr.io/<owner>/slate-core-backend`, packages desktop builds for Linux, Windows, and macOS, then creates a GitHub Release.

---

## Configuration

### Backend Environment

Copy `apps/core-backend/.env.example` to `apps/core-backend/.env`.

Common values:

| Variable                        | Purpose                                              |
| ------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                  | PostgreSQL connection string                         |
| `JWT_SECRET`                    | Secret for app JWTs                                  |
| `UPLOAD_ROOT`                   | Local filesystem attachment root                     |
| `OIDC_SECRET_ENCRYPTION_KEY`    | Encryption key for OIDC client secrets               |
| `GOOGLE_CALENDAR_CLIENT_ID`     | Google Calendar OAuth client ID                      |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar OAuth client secret                  |
| `GOOGLE_CALENDAR_REDIRECT_URI`  | Calendar OAuth callback, usually `/api/calendar/...` |
| `CALENDAR_ENCRYPTION_KEY`       | Encryption key for stored calendar OAuth tokens      |
| `PORT`                          | Backend HTTP port, defaults to `4000`                |
| `LOG_LEVEL`                     | Backend log level, defaults to `info`                |

The backend loads env from `.env`, `apps/core-backend/.env`, or the built app directory. In tests, `.env.test` is checked first.

### AI

AI settings are managed in the desktop settings UI after signing in to a backend. Supported provider families:

| Provider          | Chat | Embeddings | Notes                              |
| ----------------- | ---- | ---------- | ---------------------------------- |
| Anthropic         | Yes  | No         | Claude models                      |
| OpenAI            | Yes  | Yes        | OpenAI chat and embedding models   |
| Ollama            | Yes  | Yes        | Local models                       |
| OpenAI-compatible | Yes  | Yes        | Custom base URL and compatible API |

Embedding setup enables vector search and note graph rebuilds.

### OIDC

OIDC providers are configured through the admin UI/API. Required scopes default to:

```text
openid profile email
```

Register redirect URIs that match the client flow:

| Client  | Redirect URI                                      |
| ------- | ------------------------------------------------- |
| Admin   | Admin app callback URI used by the admin frontend |
| Desktop | `http://127.0.0.1:<port>/oidc/callback`           |

Relevant admin API routes:

```text
GET    /internal/admin/auth/oidc/providers
POST   /internal/admin/auth/oidc/start
POST   /internal/admin/auth/oidc/complete
GET    /internal/admin/oidc/providers
POST   /internal/admin/oidc/providers
PATCH  /internal/admin/oidc/providers/:providerId
DELETE /internal/admin/oidc/providers/:providerId
PATCH  /internal/admin/settings/password-auth-enabled
```

Password auth can only be disabled when an enabled OIDC provider exists and at least one admin has logged in with OIDC.

### Storage

Attachments can use local filesystem storage or S3-compatible storage. Configure this from admin storage settings. The compose file includes MinIO for local S3-compatible testing.

### Integrations

Most integrations require a backend connection and sign-in. Enable extension panels from Settings:

- Calendar
- Diagrams
- Checklists
- Linkwarden
- Jira
- GitHub/GitLab forge
- Home Assistant
- MCP servers for AI tool access

---

## Make Commands

| Command                        | Description                             |
| ------------------------------ | --------------------------------------- |
| `make install`                 | Install workspace dependencies          |
| `make format`                  | Format repository with Prettier         |
| `make desktop-up`              | Start desktop app in dev mode           |
| `make desktop-rebuild-native`  | Run desktop native rebuild placeholder  |
| `make desktop-lint`            | Type-check desktop app                  |
| `make desktop-test`            | Run desktop node tests                  |
| `make desktop-build`           | Build desktop renderer                  |
| `make desktop-package`         | Package desktop installers              |
| `make desktop-icon`            | Regenerate macOS `.icns` from icon PNG  |
| `make db-up` / `make db-down`  | Start / stop PostgreSQL                 |
| `make db-reset`                | Recreate PostgreSQL volume              |
| `make db-prisma-generate`      | Generate Prisma client                  |
| `make db-migrate-deploy`       | Apply migrations to local dev database  |
| `make db-migrate-dev NAME=...` | Create a new Prisma migration           |
| `make core-dev`                | Start backend dev server on port `4000` |
| `make core-up`                 | Start backend Docker service            |
| `make core-logs`               | Tail backend Docker logs                |
| `make core-test`               | Run backend tests against `slate_test`  |
| `make core-lint`               | Type-check backend                      |
| `make stack-up`                | Start backend Docker service            |
| `make stack-logs`              | Tail backend Docker logs                |
| `make stack-down`              | Stop Docker services                    |

---

## Contributing

1. Create a branch.
2. Make the change.
3. Run focused tests plus relevant lint/type checks.
4. Open a pull request.

For backend work, `make core-test` expects PostgreSQL on port `5435` and a `slate_test` database.

---

<p align="center">
  Built with Electron, React, Fastify, Prisma, and PostgreSQL.
</p>
