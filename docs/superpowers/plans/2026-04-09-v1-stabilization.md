# V1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the monorepo to a predictable, releasable self-hosted v1 state by tightening release gates, reducing monolithic code paths where they create maintenance risk, filling test/CI gaps, and documenting the supported operating model.

**Architecture:** Treat this as an umbrella stabilization plan with six independent execution tracks. Start by making release quality measurable at the repo root, then simplify the highest-risk monoliths without over-engineering for scale, preserve the admin app as a small self-hosted operations surface, and finish by codifying the release checklist and operator docs.

**Tech Stack:** npm workspaces, Electron, React 19, NestJS 11, Express/AdminJS, Prisma, PostgreSQL, TypeScript, Jest, Vitest, GitHub Actions

---

## Scope Check

This is intentionally an umbrella release-readiness plan because the repo has multiple independently shippable subsystems. Once Task 1 is complete, this plan can be split into follow-up execution plans for `desktop`, `core-backend`, and `admin-backend` if you want smaller workstreams.

## Current Repo Signals

- `apps/desktop/src/App.tsx` is the largest renderer source file at about 2,100 lines and is currently coordinating note tree state, calendar state, sync state, dialogs, connection polling, and editor wiring.
- `apps/admin-backend/src/main.ts` is the largest non-desktop file at about 1,400 lines and currently owns bootstrapping, core API access, session/auth flows, dashboard stats, and AdminJS resource definitions.
- `apps/core-backend/src/auth/auth.service.ts` is about 1,300 lines and currently mixes password auth, OIDC configuration CRUD, OIDC login flow, secret encryption, and JWT/session concerns.
- CI currently runs backend tests, desktop lint, desktop tests, and desktop build, but it does not gate `@slate/admin-backend` build/lint or `@slate/shared` tests/build.
- The root package scripts and README do not yet give one obvious “v1 release gate” command for lint, test, and build across all maintained workspaces.

## File Structure

### New Files

- `docs/architecture/monorepo-map.md` — living map of apps, packages, ownership boundaries, and runtime dependencies
- `docs/releases/v1-stable-checklist.md` — release gate, smoke-test checklist, rollback notes, and manual verification list
- `apps/desktop/src/hooks/useWorkspaceBootstrap.ts` — snapshot loading, initial hydration, and persisted UI preference bootstrap
- `apps/desktop/src/hooks/useBackendConnection.ts` — backend polling, auth refresh, and connection status transitions
- `apps/desktop/src/hooks/useCalendarWorkspace.ts` — calendar status, filters, reminders, and event mutation orchestration
- `apps/desktop/src/hooks/useNoteWorkspace.ts` — note/folder/template CRUD orchestration and active-note persistence
- `apps/admin-backend/src/config.ts` — env parsing and startup configuration
- `apps/admin-backend/src/core-api.ts` — typed helpers for calling the core backend
- `apps/admin-backend/src/auth/session.ts` — session bootstrap and access-token helpers
- `apps/admin-backend/src/dashboard/stats.ts` — dashboard aggregation queries
- `apps/admin-backend/src/resources/index.ts` — AdminJS resource registration
- `apps/admin-backend/src/config.test.ts` — config parsing tests
- `apps/admin-backend/src/core-api.test.ts` — core API request/response handling tests
- `apps/core-backend/src/config/runtime-config.ts` — validated runtime env accessors
- `apps/core-backend/src/config/runtime-config.spec.ts` — runtime config validation tests
- `apps/core-backend/src/auth/auth-crypto.service.ts` — secret encryption/decryption
- `apps/core-backend/src/auth/password-auth.service.ts` — password signup/login and TOTP-specific flows
- `apps/core-backend/src/auth/oidc-provider-config.service.ts` — OIDC provider config CRUD and validation
- `apps/core-backend/src/auth/oidc-login.service.ts` — OIDC authorization, token exchange, and profile resolution
- `apps/core-backend/src/calendar/google-calendar-token-store.ts` — persistent token/state abstraction for Google Calendar sync

### Modified Files

- `package.json` — add repo-wide stable-release scripts
- `Makefile` — add top-level lint/build/test/check targets that mirror CI
- `README.md` — align architecture and quick-start docs with actual workspace/release commands
- `.github/workflows/ci.yml` — enforce the v1 release gate on all maintained workspaces
- `.github/workflows/release.yml` — add pre-release verification and fail-fast checks
- `apps/desktop/package.json` — add renderer test runner only if needed for extracted hooks/components
- `apps/desktop/src/App.tsx` — reduce orchestration burden by delegating to hooks and smaller components
- `apps/desktop/src/lib/api.ts` — keep transport-only responsibilities after moving stateful logic into hooks
- `apps/desktop/src/components/SettingsDialog.tsx` — consume new connection/calendar hooks without owning side effects
- `apps/admin-backend/package.json` — add test script and any lightweight test dependency selected in Task 4
- `apps/admin-backend/src/main.ts` — shrink to composition/bootstrap only
- `apps/core-backend/src/auth/auth.module.ts` — register new auth services
- `apps/core-backend/src/auth/auth.service.ts` — become coordinator/facade instead of implementation dump
- `apps/core-backend/src/calendar/google-calendar.provider.ts` — delegate token/state handling
- `apps/core-backend/src/config/env.ts` — preserve `.env` discovery while delegating validation to runtime-config
- `apps/core-backend/src/main.ts` — fail fast on invalid runtime configuration

---

### Task 1: Define The V1 Release Gate

**Files:**

- Create: `docs/architecture/monorepo-map.md`
- Create: `docs/releases/v1-stable-checklist.md`
- Modify: `package.json`
- Modify: `Makefile`
- Modify: `README.md`

- [ ] **Step 1: Write the release checklist first**
      Create `docs/releases/v1-stable-checklist.md` with sections for `install`, `lint`, `test`, `build`, `desktop packaging`, `docker images`, `manual smoke tests`, and `rollback`.
- [ ] **Step 2: Map the maintained workspaces**
      Create `docs/architecture/monorepo-map.md` documenting `apps/desktop`, `apps/core-backend`, `apps/admin-backend`, `packages/shared`, and `packages/server-db`, plus note that `packages/proto` is currently empty and should either be removed or populated in a separate cleanup PR.
- [ ] **Step 3: Add one obvious repo-wide release command**
      Update `package.json` with `lint:all`, `test:all`, `build:all`, and `release:check` scripts that cover every maintained workspace instead of only `@slate/core-backend`.
- [ ] **Step 4: Mirror those scripts in `Makefile`**
      Add `check`, `build-all`, `test-all`, and `lint-all` targets so local CLI usage and CI use the same entry points.
- [ ] **Step 5: Fix README drift**
      Update `README.md` so the architecture section, test commands, and release instructions match the actual workspaces and the new release-gate commands.
- [ ] **Step 6: Verify the documentation layer**
      Run: `npm run release:check`
      Expected: lint, test, and build pass for all maintained workspaces, or the command fails with a clear first blocker.

### Task 2: Enforce Workspace Parity In CI

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`

- [ ] **Step 1: Expand the root release gate instead of adding meta-validation scripts**
      Update `package.json` so `release:check` directly runs the maintained workspace checks you actually care about for v1.
- [ ] **Step 2: Expand CI coverage**
      Update `.github/workflows/ci.yml` to run:
      `npm run test --workspace @slate/shared`
      `npm run build --workspace @slate/shared`
      `npm run lint --workspace @slate/admin-backend`
      `npm run build --workspace @slate/admin-backend`
      alongside the existing backend and desktop jobs.
- [ ] **Step 3: Guard the release workflow**
      Update `.github/workflows/release.yml` so version bumping only happens after the same release-gate checks succeed on the target SHA.
- [ ] **Step 4: Verify workflow syntax**
      Run: `npm run format:check`
      Expected: workflow YAML and script changes are formatted and parse cleanly.

### Task 3: Split The Desktop App Shell

**Files:**

- Create: `apps/desktop/src/hooks/useWorkspaceBootstrap.ts`
- Create: `apps/desktop/src/hooks/useBackendConnection.ts`
- Create: `apps/desktop/src/hooks/useCalendarWorkspace.ts`
- Create: `apps/desktop/src/hooks/useNoteWorkspace.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/components/SettingsDialog.tsx`
- Test: `apps/desktop/electron/services/*.test.mjs`

- [ ] **Step 1: Characterize the current desktop behaviors**
      Read `apps/desktop/src/App.tsx` and list every side-effect bucket in a temporary scratch note: bootstrap, note CRUD, folder CRUD, template CRUD, backend polling, calendar polling, dialog visibility, editor persistence.
- [ ] **Step 2: Add a small failing extraction target**
      Extract one pure helper first from `App.tsx` into the appropriate hook file and update or add a targeted test around the behavior it currently drives.
- [ ] **Step 3: Move bootstrap and connection logic**
      Implement `useWorkspaceBootstrap.ts` and `useBackendConnection.ts` so `App.tsx` stops owning snapshot hydration and backend polling directly.
- [ ] **Step 4: Move calendar and note orchestration**
      Implement `useCalendarWorkspace.ts` and `useNoteWorkspace.ts` so `App.tsx` becomes a composition layer instead of the source of truth for every mutation.
- [ ] **Step 5: Reduce `api.ts` back to transport**
      Keep `apps/desktop/src/lib/api.ts` focused on IPC/API wrappers; move renderer-side state reconciliation into the new hooks.
- [ ] **Step 6: Verify desktop stability**
      Run: `npm run test --workspace @slate/desktop`
      Expected: PASS, or only unrelated pre-existing failures called out explicitly in the task notes.
- [ ] **Step 7: Verify desktop build**
      Run: `npm run build --workspace @slate/desktop`
      Expected: PASS with `App.tsx` materially smaller and typecheck clean.

### Task 4: Modularize The Admin Backend

**Files:**

- Create: `apps/admin-backend/src/config.ts`
- Create: `apps/admin-backend/src/core-api.ts`
- Create: `apps/admin-backend/src/auth/session.ts`
- Create: `apps/admin-backend/src/dashboard/stats.ts`
- Create: `apps/admin-backend/src/resources/index.ts`
- Create: `apps/admin-backend/src/config.test.ts`
- Create: `apps/admin-backend/src/core-api.test.ts`
- Modify: `apps/admin-backend/package.json`
- Modify: `apps/admin-backend/src/main.ts`

- [ ] **Step 1: Keep the admin backend intentionally small**
      Do not turn the admin app into a full subsystem. Extract only the minimum seams needed to make `main.ts` readable and testable for a self-hosted single-instance deployment.
- [ ] **Step 2: Add a lightweight admin test runner**
      Update `apps/admin-backend/package.json` with a single test command and the smallest additional dependency set needed to test pure config/API modules.
- [ ] **Step 3: Write the failing tests first**
      Add `config.test.ts` covering env defaults and required values, and `core-api.test.ts` covering non-200 responses and malformed JSON from the core backend.
- [ ] **Step 4: Run the new tests to verify they fail**
      Run: `npm run test --workspace @slate/admin-backend`
      Expected: FAIL because the extracted modules do not exist yet.
- [ ] **Step 5: Extract configuration and HTTP client boundaries**
      Move env parsing into `config.ts` and core-backend fetch logic into `core-api.ts`; update `main.ts` to import them instead of owning those concerns.
- [ ] **Step 6: Extract only the highest-value helpers**
      Move session/access-token helpers into `auth/session.ts` and dashboard aggregation into `dashboard/stats.ts`.
- [ ] **Step 7: Extract AdminJS resource wiring only if it makes `main.ts` clearer**
      Move resource setup into `resources/index.ts` only if the resulting shape is simpler than the current file; skip this extraction if it merely spreads a small self-hosted app across too many files.
- [ ] **Step 8: Verify admin build and tests**
      Run: `npm run test --workspace @slate/admin-backend`
      Expected: PASS.
      Run: `npm run build --workspace @slate/admin-backend`
      Expected: PASS.

### Task 5: Split Backend Auth And Runtime Configuration

**Files:**

- Create: `apps/core-backend/src/config/runtime-config.ts`
- Create: `apps/core-backend/src/config/runtime-config.spec.ts`
- Create: `apps/core-backend/src/auth/auth-crypto.service.ts`
- Create: `apps/core-backend/src/auth/password-auth.service.ts`
- Create: `apps/core-backend/src/auth/oidc-provider-config.service.ts`
- Create: `apps/core-backend/src/auth/oidc-login.service.ts`
- Create: `apps/core-backend/src/calendar/google-calendar-token-store.ts`
- Modify: `apps/core-backend/src/config/env.ts`
- Modify: `apps/core-backend/src/main.ts`
- Modify: `apps/core-backend/src/auth/auth.module.ts`
- Modify: `apps/core-backend/src/auth/auth.service.ts`
- Modify: `apps/core-backend/src/calendar/google-calendar.provider.ts`

- [ ] **Step 1: Lock down configuration expectations with tests**
      Add `runtime-config.spec.ts` covering required env values, defaults, and invalid combinations that should fail fast during boot.
- [ ] **Step 2: Run the targeted backend config test**
      Run: `npm run test --workspace @slate/core-backend -- runtime-config.spec.ts`
      Expected: FAIL until `runtime-config.ts` exists and is wired.
- [ ] **Step 3: Implement validated runtime config**
      Create `runtime-config.ts` and update `main.ts` to load and validate configuration before the Nest app starts listening.
- [ ] **Step 4: Split `AuthService` by responsibility**
      Move encryption into `auth-crypto.service.ts`, password/TOTP flows into `password-auth.service.ts`, provider config CRUD into `oidc-provider-config.service.ts`, and OIDC login/exchange logic into `oidc-login.service.ts`.
- [ ] **Step 5: Leave `auth.service.ts` as a thin facade**
      Keep public controller-facing methods stable, but delegate internally to the new services so existing tests continue to verify the API surface.
- [ ] **Step 6: Address the calendar provider state hotspot pragmatically**
      Introduce `google-calendar-token-store.ts` only if the current in-memory state creates restart fragility or confusing operator behavior for a single self-hosted instance. Do not optimize for multi-process scale; optimize for correctness and recoverability on one node.
- [ ] **Step 7: Run backend verification**
      Run: `make core-test`
      Expected: PASS.
      Run: `npm run build --workspace @slate/core-backend`
      Expected: PASS.

### Task 6: Finalize Release Docs, Smoke Tests, And Cut Criteria

**Files:**

- Modify: `docs/releases/v1-stable-checklist.md`
- Modify: `README.md`
- Modify: `.github/workflows/release.yml`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Turn the checklist into an operator runbook**
      Add exact smoke-test flows for desktop-only mode, full-stack sync mode, admin login, attachment upload, AI settings save, calendar read, and release artifact verification.
- [ ] **Step 2: Harden compose/release assumptions**
      Update `docker-compose.yml` and release notes as needed so the documented deployment path matches the ports, env files, and services actually required for v1.
- [ ] **Step 3: Perform a local dry run**
      Run:
      `npm install`
      `npm run release:check`
      `make desktop-build`
      Expected: all commands pass, or the checklist records the exact remaining blockers.
- [ ] **Step 4: Perform a release-workflow dry read**
      Review `.github/workflows/release.yml` against `docs/releases/v1-stable-checklist.md` and remove any undocumented release-only behavior.

## Exit Criteria

- `npm run release:check` exists and is the canonical local/CI release gate.
- CI covers every maintained workspace needed for a self-hosted v1 release.
- `apps/desktop/src/App.tsx`, `apps/admin-backend/src/main.ts`, and `apps/core-backend/src/auth/auth.service.ts` are each materially reduced and no longer own multiple unrelated responsibilities.
- Admin backend stays intentionally small and has baseline automated coverage for config and core API behavior.
- Backend runtime configuration fails fast and the Google Calendar provider behavior is reliable for a single self-hosted node.
- Release and smoke-test documentation are accurate enough for a teammate with zero context to cut a release safely.
