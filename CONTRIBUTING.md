# Contributing to Slate

Thanks for helping improve Slate. This project is a small monorepo; keep changes focused and verify the area you touch.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Follow [Getting Started](README.md#getting-started) in the README.

Quick full-stack loop:

```bash
make install
cp apps/core-backend/.env.example apps/core-backend/.env
# Edit apps/core-backend/.env — set strong JWT_SECRET / encryption keys for anything beyond local toys
make db-up
make db-prisma-generate
make db-migrate-deploy
make core-dev          # terminal 1 — http://localhost:4000
make desktop-up        # terminal 2
```

Desktop-only (local notes, no backend):

```bash
make install
make desktop-up
```

Useful entry points:

| Path                               | Role                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Makefile`                         | Preferred short commands (`make help` is not defined; see README Make table)                   |
| Root `package.json` `scripts`      | npm equivalents (`dev:desktop`, `dev:core-backend`, `db:*`, `stack:*`)                         |
| `scripts/patch-adminjs-exports.js` | Runs on `postinstall` to patch AdminJS export quirks — do not remove without checking Admin UI |
| `docs/SELF_HOSTING.md`              | Self-host / OAuth / PAT notes for friends running their own backend                            |

## Branch and PR workflow

1. Branch from the latest default branch (`main`).
2. Keep commits small and messages descriptive (`fix:`, `feat:`, `docs:`, `chore:`).
3. Run the checks that match your change (below).
4. Open a pull request with a short summary of _what_ and _why_.

Do not commit secrets, real `.env` files, API keys, or personal OAuth client secrets. Use placeholders only in examples.

## What to run before you push

Backend:

```bash
# Once per machine: create the test DB
docker compose exec -T postgres psql -U slate -d slate -c 'CREATE DATABASE slate_test OWNER slate;'
cp apps/core-backend/.env.test.example apps/core-backend/.env.test   # if you do not already have one

make core-lint
make core-test
```

Desktop:

```bash
make desktop-lint
make desktop-test
```

Shared package:

```bash
npm run test --workspace @slate/shared
```

Formatting (optional but appreciated):

```bash
make format
```

CI on GitHub runs backend tests (Postgres + pgvector), desktop typecheck, desktop node tests, and a desktop production build.

## Scope guidelines

- Prefer fixing or documenting real behavior over drive-by refactors.
- Product claims in docs must match `Makefile`, `package.json`, `docker-compose.yml`, and the apps under `apps/`.
- New env vars belong in `apps/core-backend/.env.example` (and `.env.test.example` when tests need them), the README configuration table, and [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) when they affect deployers.
- Admin UI lives inside `core-backend` (AdminJS). There is no separate `admin` Compose service.

## Security reports

Please do not open public issues for sensitive vulnerabilities. See [SECURITY.md](SECURITY.md).
