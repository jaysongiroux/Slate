# Security

## Reporting a vulnerability

If you find a security issue in Slate (auth bypass, secret leakage, RCE in the desktop shell, unsafe deserialization, etc.), please **do not** open a public GitHub issue.

Email the maintainer privately (GitHub profile contact for [jaysongiroux](https://github.com/jaysongiroux)) or open a private security advisory on the GitHub repository once it is public.

Include:

- Affected component (`apps/desktop`, `apps/core-backend`, packaging, CI)
- Steps to reproduce
- Impact assessment
- Patch or mitigation ideas if you have them

## Secrets and configuration

Never commit real secrets. Use:

```bash
cp apps/core-backend/.env.example apps/core-backend/.env
```

and fill in local values. `.env` is gitignored.

Before any **production** or internet-exposed deploy, replace all placeholder/dev defaults:

| Variable                        | Notes                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                    | Required for real auth. Dev code falls back to a hard-coded local default if unset — **not safe for production**. |
| `ENCRYPTION_SECRET`             | Encrypts Forge / Jira / Linkwarden / Home Assistant / MCP tokens. Dev fallback exists — set a strong value.       |
| `AI_ENCRYPTION_KEY`             | Encrypts AI provider API keys at rest. Dev fallback exists — set a strong value in production.                    |
| `OIDC_SECRET_ENCRYPTION_KEY`    | Encrypts OIDC client secrets at rest. Dev fallback exists — set a strong value in production.                     |
| `CALENDAR_ENCRYPTION_KEY`       | Encrypts calendar OAuth tokens. Dev fallback exists — set a strong value in production.                           |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | From your Google Cloud OAuth client. Prefer configuring via admin settings when possible; env is for bootstrap.   |
| Database / MinIO passwords      | Compose defaults (`slate` / `slateminio`) are for local dev only.                                                 |

Also:

- Do not publish `apps/core-backend/.env`, root `.env`, or any file containing OAuth client secrets.
- Rotate Google OAuth client secrets (and any other credentials) if they ever appeared in a shared machine, screenshot, or git history.
- Attachment storage (default `<backend cwd>/data/attachments`, or S3 via Admin) may hold user content — protect the volume/bucket and backups.

## Desktop (Electron) notes

- The desktop app is an Electron shell. Treat third-party Markdown, HTML, Mermaid, and remote content as untrusted; keep Electron and dependencies updated.
- Packaged macOS builds distributed to other people typically need signing and notarization or Gatekeeper will block them. Windows SmartScreen has similar friction for unsigned installers.
- Dev mode remaps Electron `userData` away from the generic `Electron` directory into an app-specific `Slate` path so settings survive reloads — that path can contain tokens and local note data; back it up / protect it like any local app data.

## Dependency and supply chain

- Prefer `npm ci` / lockfile installs for reproducible builds.
- Review GitHub Actions and release workflows before granting `packages:write` or broader tokens on a fork.

## Self-hosting

Operational setup (OAuth, PATs, Compose, TLS): [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
