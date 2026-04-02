# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three GitHub Actions workflows with a consolidated CI workflow and an auto-release workflow that publishes Docker images to GHCR and desktop installers to GitHub Releases on every merge to `main`.

**Architecture:** Two workflows — `ci.yml` runs lint/test/build on PRs and pushes to `main`; `release.yml` triggers after CI passes on `main`, auto-increments the patch version, builds Docker images + desktop packages, and creates a GitHub Release with all artifacts.

**Tech Stack:** GitHub Actions, Docker (GHCR), electron-builder, shell scripting for version bumps

**Spec:** `docs/superpowers/specs/2026-03-25-cicd-pipeline-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `.github/workflows/ci.yml` | Consolidated CI: backend tests, desktop lint/test/build |
| Create | `.github/workflows/release.yml` | Auto-release: version bump, Docker images, desktop packages, GitHub Release |
| Delete | `.github/workflows/backend-ci.yml` | Replaced by `ci.yml` |
| Delete | `.github/workflows/desktop-ci.yml` | Replaced by `ci.yml` |
| Delete | `.github/workflows/desktop-package.yml` | Replaced by `release.yml` |

No application code changes. Only workflow files are affected.

**Note:** The old workflows triggered on `codex/**` branches. This is intentionally removed — the repo only uses `main`.

---

### Task 1: Create the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `ci.yml`**

This consolidates the existing `backend-ci.yml` and `desktop-ci.yml` into one workflow with four parallel jobs.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_DB: slate
          POSTGRES_USER: slate
          POSTGRES_PASSWORD: slate
        ports:
          - 5435:5432
        options: >-
          --health-cmd "pg_isready -U slate -d slate"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://slate:slate@localhost:5435/slate?schema=public
      JWT_SECRET: ci-secret
      UPLOAD_ROOT: ./uploads

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: make install
      - run: make db-prisma-generate
      - run: make db-migrate-deploy

      - name: Create slate_test database
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y --no-install-recommends postgresql-client
          PGPASSWORD=slate psql -h 127.0.0.1 -p 5435 -U slate -d slate -tc \
            "SELECT 1 FROM pg_database WHERE datname = 'slate_test'" | grep -q 1 \
            || PGPASSWORD=slate psql -h 127.0.0.1 -p 5435 -U slate -d slate -c \
            "CREATE DATABASE slate_test OWNER slate;"

      - run: make core-test

  desktop-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: make install
      - run: make desktop-lint

  desktop-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: make install
      - run: make desktop-test

  desktop-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: make install
      - run: make desktop-build
```

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add consolidated CI workflow"
```

---

### Task 2: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `release.yml`**

This is the full release workflow with four jobs: version-bump, docker-images, desktop-package, github-release.

```yaml
name: Release

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write
  packages: write

jobs:
  version-bump:
    runs-on: ubuntu-latest
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success')
      || github.event_name == 'workflow_dispatch'
    outputs:
      version: ${{ steps.bump.outputs.version }}
      tag: ${{ steps.bump.outputs.tag }}
      sha: ${{ steps.bump.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Bump version, commit, and tag
        id: bump
        run: |
          CURRENT=$(node -p "require('./package.json').version")
          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          PATCH=$((PATCH + 1))
          NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
          TAG="v${NEW_VERSION}"

          # Check if tag already exists (re-run scenario)
          if git rev-parse "$TAG" >/dev/null 2>&1; then
            echo "Tag $TAG already exists — using existing tag"
            SHA=$(git rev-parse "$TAG")
            echo "version=$NEW_VERSION" >> "$GITHUB_OUTPUT"
            echo "tag=$TAG" >> "$GITHUB_OUTPUT"
            echo "sha=$SHA" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          # Update root package.json
          node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            pkg.version = '${NEW_VERSION}';
            fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
          "

          # Update desktop package.json
          node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('apps/desktop/package.json', 'utf8'));
            pkg.version = '${NEW_VERSION}';
            fs.writeFileSync('apps/desktop/package.json', JSON.stringify(pkg, null, 2) + '\n');
          "

          git add package.json apps/desktop/package.json
          git commit -m "chore: release ${TAG} [skip ci]"
          git tag "$TAG"
          git push origin main --follow-tags

          SHA=$(git rev-parse HEAD)
          echo "version=$NEW_VERSION" >> "$GITHUB_OUTPUT"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"

  docker-images:
    needs: version-bump
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [core-backend, admin-backend]
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.version-bump.outputs.sha }}

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/slate-${{ matrix.app }}:${{ needs.version-bump.outputs.version }}
            ghcr.io/${{ github.repository_owner }}/slate-${{ matrix.app }}:latest

  desktop-package:
    needs: version-bump
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
          - os: windows-latest
            platform: windows
          - os: macos-latest
            platform: macos

    runs-on: ${{ matrix.os }}

    env:
      CSC_IDENTITY_AUTO_DISCOVERY: false

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.version-bump.outputs.sha }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - name: Install Linux packaging dependencies
        if: matrix.platform == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libfuse2 || sudo apt-get install -y libfuse2t64

      - run: make install
      - run: make desktop-package

      - name: Upload Linux (AppImage)
        if: matrix.platform == 'linux'
        uses: actions/upload-artifact@v4
        with:
          name: slate-linux
          path: apps/desktop/dist/*.AppImage
          if-no-files-found: error

      - name: Upload Windows (NSIS)
        if: matrix.platform == 'windows'
        uses: actions/upload-artifact@v4
        with:
          name: slate-windows
          path: apps/desktop/dist/*.exe
          if-no-files-found: error

      - name: Upload macOS (DMG + zip)
        if: matrix.platform == 'macos'
        uses: actions/upload-artifact@v4
        with:
          name: slate-macos
          path: |
            apps/desktop/dist/*.dmg
            apps/desktop/dist/*mac*.zip
          if-no-files-found: error

  github-release:
    needs: [version-bump, docker-images, desktop-package]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.version-bump.outputs.sha }}

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: release-assets

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          TAG="${{ needs.version-bump.outputs.tag }}"
          VERSION="${{ needs.version-bump.outputs.version }}"
          OWNER="${{ github.repository_owner }}"

          # Collect all files from artifact subdirectories
          FILES=()
          for f in release-assets/*/*; do
            [ -f "$f" ] && FILES+=("$f")
          done

          # Create the release with auto-generated notes first
          gh release create "$TAG" "${FILES[@]}" \
            --title "$TAG" \
            --generate-notes

          # Prepend Docker pull commands to the release body
          EXISTING=$(gh release view "$TAG" --json body -q .body)
          BODY=$(cat <<EOF
          ## Docker Images

          \`\`\`bash
          docker pull ghcr.io/${OWNER}/slate-core-backend:${VERSION}
          docker pull ghcr.io/${OWNER}/slate-admin-backend:${VERSION}
          \`\`\`

          ${EXISTING}
          EOF
          )
          gh release edit "$TAG" --notes "$BODY"
```

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add auto-release workflow"
```

---

### Task 3: Delete old workflows

**Files:**
- Delete: `.github/workflows/backend-ci.yml`
- Delete: `.github/workflows/desktop-ci.yml`
- Delete: `.github/workflows/desktop-package.yml`

- [ ] **Step 1: Remove the three old workflow files**

```bash
rm .github/workflows/backend-ci.yml
rm .github/workflows/desktop-ci.yml
rm .github/workflows/desktop-package.yml
```

- [ ] **Step 2: Verify only the new workflows remain**

Run: `ls .github/workflows/`
Expected: `ci.yml  release.yml`

- [ ] **Step 3: Commit**

```bash
git add -A .github/workflows/
git commit -m "ci: remove old workflow files replaced by ci.yml and release.yml"
```

---

### Task 4: Validate the full pipeline locally

- [ ] **Step 1: Verify all YAML files parse correctly**

Run: `python3 -c "import yaml; [yaml.safe_load(open(f'.github/workflows/{f}')) for f in ['ci.yml', 'release.yml']]"`
Expected: No output (both valid)

- [ ] **Step 2: Verify the CI workflow name matches the release workflow_run reference**

The `release.yml` has `workflows: [CI]` and `ci.yml` has `name: CI`. These must match exactly (case-sensitive).

Run: `grep '^name:' .github/workflows/ci.yml`
Expected: `name: CI`

- [ ] **Step 3: Verify Dockerfile paths referenced in release.yml exist**

Run: `ls apps/core-backend/Dockerfile apps/admin-backend/Dockerfile`
Expected: Both files listed

- [ ] **Step 4: Verify Makefile targets referenced in ci.yml exist**

Run: `grep -E '^[a-z]' Makefile | sed 's/:.*//' | sort`
Expected: Should include `install`, `core-test`, `desktop-lint`, `desktop-test`, `desktop-build`, `desktop-package`, `db-prisma-generate`, `db-migrate-deploy`

- [ ] **Step 5: Final commit if any fixes were needed**

Only if changes were made during validation. Otherwise skip.
