# Slate

Slate is a cross-platform Markdown workspace with local-first storage, optional backend sync, and a compact gRPC protocol.

## Workspace layout

- `apps/core-backend`: NestJS gRPC core backend for product-critical APIs
- `apps/admin-backend`: Express + AdminJS backend for admin UI and dashboards
- `apps/desktop`: Electron + React desktop client with preload bridge, local workspace services, and backend sync wiring
- `packages/server-db`: shared Prisma schema/client package used by both backends
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
2. Start Postgres locally or via `make db-up`.
3. Copy `apps/core-backend/.env.example` to `apps/core-backend/.env`.
4. Copy `apps/admin-backend/.env.example` to `apps/admin-backend/.env`.
5. Copy `apps/core-backend/.env.test.example` to `apps/core-backend/.env.test`.
6. Generate Prisma client with `make db-prisma-generate`.
7. Apply migrations with `make db-migrate-deploy`.
8. Create a dedicated test database once: `docker compose exec -T postgres psql -U slate -c 'CREATE DATABASE slate_test;'`.
9. Run core backend tests with `make core-test` (this now targets `slate_test` and refuses non-test DBs).
10. Start the core backend with `make core-dev`.
11. Start the admin backend with `make admin-dev`.
12. Start the Electron desktop app with `npm run dev:desktop`.

To create a new migration from schema changes, run `make db-migrate-dev NAME=your_migration_name`.

Docker-based startup:

1. Copy both backend `.env.example` files to `.env`.
2. Start Postgres with `make db-up`.
3. Apply migrations with `make db-migrate-deploy`.
4. Start both services with `make stack-up`.
5. Tail logs with `make stack-logs`.
6. Stop the stack with `make stack-down`.

## OIDC setup (quick reference)

When configuring an OIDC app (Google, GitHub Enterprise OIDC, Zitadel, etc.), register these redirect URIs:

- Admin login callback: `https://<your-admin-host>/admin/login/oidc/callback`
- Desktop login callback pattern: `http://127.0.0.1:<port>/oidc/callback`

Use scopes that include at least:

- `openid profile email`

OIDC providers are managed through core admin endpoints (authenticated with an internal admin token):

- Create provider: `POST /internal/admin/oidc/providers`
- Update provider: `PATCH /internal/admin/oidc/providers/:providerId`
- Delete provider: `DELETE /internal/admin/oidc/providers/:providerId`
- Toggle password auth: `PATCH /internal/admin/settings/password-auth-enabled`

Password auth can only be disabled when both are true:

- At least one OIDC provider is enabled.
- At least one admin has successfully logged in via OIDC.

## Notes

- Electron packaging uses Electron Builder from `apps/desktop`.
- GitHub Actions is configured to run core backend integration tests against a real Postgres service.
