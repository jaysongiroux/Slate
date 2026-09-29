# Self-hosting Slate

This guide is for running your own Slate backend so the desktop app can sync, use AI, calendars, admin, and integrations. Desktop-only local notes need none of this — see [Getting Started](../README.md#getting-started).

## Quick stack

```bash
cp apps/core-backend/.env.example apps/core-backend/.env
# Edit .env — set JWT_SECRET, ENCRYPTION_SECRET, AI_ENCRYPTION_KEY,
# OIDC_SECRET_ENCRYPTION_KEY, and CALENDAR_ENCRYPTION_KEY (openssl rand -hex 32)

make install
make db-up
make db-prisma-generate
make db-migrate-deploy
make core-dev          # http://localhost:4000
# other terminal:
make desktop-up
```

In the desktop app: Settings → server → `http://localhost:4000`, then sign in.

First-time admin: open `http://localhost:4000/admin/setup` and create the initial administrator. That page disables itself after the first user exists. Admin UI thereafter: `http://localhost:4000/admin`.

## Docker Compose

`docker-compose.yml` provides:

| Service      | Host ports | Role                                      |
| ------------ | ---------- | ----------------------------------------- |
| postgres     | 5435       | PostgreSQL 16 + pgvector                  |
| core-backend | 4000       | API + AdminJS (needs `apps/core-backend/.env`) |
| minio        | 9000, 9001 | Optional S3-compatible storage            |

```bash
cp apps/core-backend/.env.example apps/core-backend/.env
make db-up
make db-migrate-deploy
make stack-up      # backend container
make stack-logs
```

**Linux Docker Engine:** the compose file points the backend at `host.docker.internal:5435`. On Linux, either add under `core-backend`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

or set `DATABASE_URL` to the in-compose Postgres service (`postgresql://slate:slate@postgres:5432/slate?schema=public`) when both services run in the same compose network.

Compose defaults (`slate` / `slateminio` passwords) are for local toys only — change them before any shared or internet-facing deploy.

Published port `50051` is a legacy compatibility expose; the current HTTP API is **4000**. Prefer `4000` in Settings.

## Required secrets

See `apps/core-backend/.env.example` and [SECURITY.md](../SECURITY.md). At minimum set:

| Variable                     | Protects                                      |
| ---------------------------- | --------------------------------------------- |
| `JWT_SECRET`                 | App session / API JWTs                        |
| `ENCRYPTION_SECRET`          | Forge, Jira, Linkwarden, Home Assistant, MCP tokens |
| `AI_ENCRYPTION_KEY`          | AI provider API keys at rest                  |
| `OIDC_SECRET_ENCRYPTION_KEY` | OIDC client secrets at rest                   |
| `CALENDAR_ENCRYPTION_KEY`    | Calendar OAuth tokens at rest                 |

Unset values fall back to hard-coded local-dev strings — fine for a laptop, unsafe anywhere else.

Attachment files default to `<backend cwd>/data/attachments` (Admin → storage can switch to S3). There is **no** `UPLOAD_ROOT` environment variable.

## Google Calendar OAuth

Calendar Google sync needs a Google Cloud OAuth **Web** client (not an Android/iOS client).

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. Enable **Google Calendar API**, and for attendee search also **People API** (Contacts / Other contacts / Directory scopes as needed).
3. Configure the OAuth consent screen (External or Internal for Workspace).
4. Create credentials → **OAuth client ID** → Application type **Web application**.
5. Authorized redirect URI (local default):

   ```text
   http://localhost:4000/api/calendar/oauth/callback
   ```

   For a public hostname, use `https://<your-host>/api/calendar/oauth/callback` and set `GOOGLE_CALENDAR_REDIRECT_URI` to the same value.
6. Put Client ID / Secret in `.env` **or** Admin → calendar settings (env seeds the DB on first run; Admin edits win afterward).

Scopes requested by Slate include Calendar plus Contacts / Other contacts / Directory read for attendee search.

## Forge (GitHub / GitLab) — personal access tokens

Forge is **not** a GitHub/GitLab OAuth App. Each user pastes a personal access token (PAT) in the desktop Forge panel after signing in to your backend.

| Provider | Typical token | Notes                                      |
| -------- | ------------- | ------------------------------------------ |
| GitHub   | Classic or fine-grained PAT | Needs repo/issues/PR read scopes you care about |
| GitLab   | Personal access token       | Point base URL at gitlab.com or your instance API |

Tokens are encrypted with `ENCRYPTION_SECRET` and stored per user. Do not commit PATs.

## Jira — email + API token

Jira integration uses Atlassian **email + API token** (basic auth), configured per user in the desktop Jira panel — not a shared OAuth app in `.env`.

1. Create an API token at [Atlassian account security](https://id.atlassian.com/manage-profile/security/api-tokens).
2. In Slate (signed in to your backend), add the instance base URL, email, and token.

Tokens are encrypted with `ENCRYPTION_SECRET`.

## OIDC login (optional)

Configure OIDC providers in Admin (not only via env). Register redirect URIs:

| Client  | Redirect URI                            |
| ------- | --------------------------------------- |
| Admin   | Your admin callback (shown in Admin UI) |
| Desktop | `http://127.0.0.1:<port>/oidc/callback` |

Default scopes: `openid profile email`. Password auth can only be disabled when an enabled OIDC provider exists and at least one admin has logged in with OIDC. See README Configuration → OIDC.

## MinIO / S3 attachments

```bash
docker compose up -d minio
# Console: http://localhost:9001  (compose defaults: slateminio / slateminio)
```

In Admin → storage, set backend to S3 and point endpoint/bucket/keys at MinIO or any S3-compatible store. Create the bucket first.

## Production checklist

- [ ] Strong random values for all five secret keys above
- [ ] Non-default DB and MinIO passwords
- [ ] TLS terminator in front of port 4000 (Caddy, nginx, Traefik, cloud LB)
- [ ] Correct public `GOOGLE_CALENDAR_REDIRECT_URI` if using Calendar
- [ ] Backups for Postgres and the attachments volume/bucket
- [ ] Review GitHub Actions / GHCR publish permissions before using the release workflow

Desktop packaging and CI are covered in the [README](../README.md#ci-and-releases).
