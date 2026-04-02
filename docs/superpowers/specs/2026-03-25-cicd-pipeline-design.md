# CI/CD Pipeline Design

## Context

Slate is a monorepo with three apps (`core-backend`, `admin-backend`, `desktop`) and three packages (`server-db`, `shared`, `proto`). The backend is self-hosted by users via Docker. The desktop app is an Electron application distributed as platform-specific installers.

Currently there are three GitHub Actions workflows (`backend-ci.yml`, `desktop-ci.yml`, `desktop-package.yml`) that run tests and produce unsigned desktop artifacts. There is no release workflow, no versioning automation, and no Docker image publishing.

## Goals

- Consolidate CI into a single workflow
- Automatically release on every merge to `main`: bump version, publish Docker images to GHCR, build desktop installers, create a GitHub Release
- Keep it simple and dependency-free (no third-party release tools)

## Workflow Architecture

Two workflows replace the existing three:

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| CI | `ci.yml` | PRs + push to `main` | Lint + test everything |
| Release | `release.yml` | `workflow_run` after CI succeeds on `main` | Version bump, Docker images, desktop packages, GitHub Release |

Additionally, `release.yml` includes a `workflow_dispatch` trigger for manual re-runs (e.g., if a release partially fails after the version tag was pushed).

Delete: `backend-ci.yml`, `desktop-ci.yml`, `desktop-package.yml`.

## Permissions

- `ci.yml`: default permissions (read-only) are sufficient
- `release.yml`:
  - `contents: write` — push version-bump commits/tags and create GitHub Releases
  - `packages: write` — push Docker images to GHCR

## CI Workflow (`ci.yml`)

Triggers: `pull_request` and `push` to `main`.

Concurrency: `ci-${{ github.ref }}`, cancel-in-progress: true (superseded PR pushes are cancelled).

All jobs use setup-node 22 with `cache: npm` and `cache-dependency-path: package-lock.json`.

Four parallel jobs:

### `backend-test`
- Runner: `ubuntu-latest`
- Service: `pgvector/pgvector:pg16` on port 5435
- Env: `DATABASE_URL`, `JWT_SECRET`, `UPLOAD_ROOT`
- Steps: checkout, setup-node 22, `make install`, `make db-prisma-generate`, `make db-migrate-deploy`, create `slate_test` database, `make core-test`

### `desktop-lint`
- Runner: `ubuntu-latest`
- Steps: checkout, setup-node 22, `make install`, `make desktop-lint`

### `desktop-test`
- Runner: `ubuntu-latest`
- Steps: checkout, setup-node 22, `make install`, `make desktop-test`

### `desktop-build`
- Runner: `ubuntu-latest`
- Steps: checkout, setup-node 22, `make install`, `make desktop-build`

## Release Workflow (`release.yml`)

Triggers:
- `workflow_run`: runs after `ci.yml` completes on `main` (type: `completed`)
- `workflow_dispatch`: manual re-run for recovery

**Important:** All jobs must include `if: github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch'` to ensure the release only proceeds when CI passed (the `workflow_run` event fires on completion regardless of outcome).

Concurrency: `release`, cancel-in-progress: false (rapid merges queue rather than overlap).

### Job 1: `version-bump`

1. Checkout with `fetch-depth: 0` and `GITHUB_TOKEN`
2. Read current version from root `package.json`
3. Increment patch: `0.1.0` -> `0.1.1`
4. Update version in root `package.json` and `apps/desktop/package.json`
5. Commit with message `chore: release v0.1.1 [skip ci]`
6. Tag `v0.1.1`
7. Push commit and tag
8. Output `version` and `tag` for downstream jobs

Note on branch protection: If `main` has required status checks or reviews, the `GITHUB_TOKEN` push will be rejected. In that case, configure a GitHub App token or PAT as `secrets.RELEASE_TOKEN` and use it for the checkout/push steps. For repos without branch protection, the default `GITHUB_TOKEN` works.

Note on package.json scope: Only the root and desktop `package.json` files are updated. The other workspace packages (`core-backend`, `admin-backend`, `shared`, `server-db`) have `"version": "0.1.0"` and cross-reference each other (e.g., `"@slate/shared": "0.1.0"`), but npm workspaces resolves these by path, not version — so they do not need to stay in sync. The Docker image version comes from the git tag, not from the package.json inside the image.

### Job 2: `docker-images` (needs: version-bump)

Matrix: `[core-backend, admin-backend]` with `fail-fast: false`.

1. Checkout at the version-bump commit (using the SHA output from version-bump)
2. Login to GHCR (`ghcr.io`) using `GITHUB_TOKEN`
3. Build Docker image using existing `apps/<app>/Dockerfile` with build context at repo root
4. Tag as `ghcr.io/jaysongiroux/slate-<app>:<version>` and `ghcr.io/jaysongiroux/slate-<app>:latest`
5. Push both tags

### Job 3: `desktop-package` (needs: version-bump)

Matrix with `fail-fast: false`:

| Runner | Platform |
|---|---|
| `ubuntu-latest` | linux |
| `windows-latest` | windows |
| `macos-latest` | macos |

Env: `CSC_IDENTITY_AUTO_DISCOVERY: false` (skip macOS code signing on GitHub-hosted runners).

1. Checkout at the version-bump commit
2. Setup Node 22 with npm cache, install deps
3. Install Linux packaging dependencies (libfuse2, if linux)
4. `make desktop-package`
5. Upload platform artifacts (AppImage, exe, DMG+zip)

### Job 4: `github-release` (needs: docker-images, desktop-package)

1. Download all desktop artifacts from the matrix jobs
2. Create GitHub Release for the tag using `gh release create`
3. Attach desktop artifacts (DMG, exe, AppImage)
4. Auto-generate release notes from commits since the previous tag
5. Include Docker image pull commands in the release body

## Version Bump Mechanics

- Shell-based, no external tools. Uses `node -e` to read/write `package.json` version fields.
- Commit message includes `[skip ci]` to prevent re-triggering the CI workflow.
- For manual minor/major bumps: edit `package.json` version before merging. The pipeline picks up from there and auto-increments patch on the next release.

## Failure Recovery

If `version-bump` succeeds but a downstream job (`docker-images` or `desktop-package`) fails:
- The git tag and version-bump commit already exist
- Use `workflow_dispatch` to re-run the release workflow — the version-bump job should detect the tag already exists and skip to the same version/commit
- Alternatively, re-run the failed jobs individually from the GitHub Actions UI

## GHCR Image Names

- `ghcr.io/jaysongiroux/slate-core-backend:<version>`
- `ghcr.io/jaysongiroux/slate-core-backend:latest`
- `ghcr.io/jaysongiroux/slate-admin-backend:<version>`
- `ghcr.io/jaysongiroux/slate-admin-backend:latest`

## Files Changed

- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Delete: `.github/workflows/backend-ci.yml`
- Delete: `.github/workflows/desktop-ci.yml`
- Delete: `.github/workflows/desktop-package.yml`
