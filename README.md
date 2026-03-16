# Slate

Slate is a cross-platform Markdown workspace with local-first storage, optional backend sync, and a compact gRPC protocol.

## Workspace layout

- `apps/backend`: NestJS gRPC backend with Prisma/Postgres and integration-first tests
- `apps/desktop`: Electron + React desktop client with preload bridge, local workspace services, and backend sync wiring
- `packages/proto`: protobuf contracts shared across services
- `packages/shared`: shared TypeScript types and constants

## Current status

This repository is scaffolded for the v1 architecture:

- local filesystem-first desktop app
- optional backend linking
- multi-user backend with isolated personal workspaces
- email/password + TOTP + OIDC auth interfaces
- PostgreSQL full-text search
- Postgres-backed async job abstraction

## Local development

1. Install dependencies with `npm install`.
2. Start Postgres locally or via `make backend-db-up`.
3. Copy `apps/backend/.env.example` to `apps/backend/.env`.
4. Generate Prisma client with `make backend-prisma-generate`.
5. Apply the checked-in schema with `make backend-db-migrate`.
6. Run backend tests with `make backend-test`.
7. Start the backend with `npm run dev:backend`.
8. Start the Electron desktop app with `npm run dev:desktop`.

The backend also supports Docker-based startup using `apps/backend/.env`:

1. Copy `apps/backend/.env.example` to `apps/backend/.env`.
2. Start Postgres with `make backend-db-up`.
3. Apply migrations with `make backend-db-migrate`.
4. Start the backend container with `make backend-up`.
5. Tail logs with `make backend-logs`.

## Notes

- Electron packaging uses Electron Builder from `apps/desktop`.
- GitHub Actions is configured to run backend integration tests against a real Postgres service.
