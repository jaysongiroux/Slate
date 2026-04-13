# AdminJS Fastify Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the separate `admin-backend` service into `core-backend` by mounting AdminJS directly in Fastify, reusing the existing admin auth services, and deleting any `/internal/admin/*` endpoints that are only legacy HTTP bridge layers.

**Architecture:** Keep admin business rules in `AuthAdminService`, `AuthOidcService`, settings/storage services, and Prisma. Move the AdminJS resource/actions layer into `apps/core-backend`, switch from `@adminjs/express` to `@adminjs/fastify`, and let AdminJS actions call in-process services directly instead of hopping through `/internal/admin/*` APIs. Keep only the minimal `/admin/*` routes required for setup and OIDC login flow; remove bridge endpoints once AdminJS no longer depends on them.

**Tech Stack:** Fastify 5, AdminJS, `@adminjs/fastify`, `@adminjs/prisma`, Prisma, Jest, Supertest, Docker Compose, GitHub Actions

---

## File Structure

**Modify**

- `apps/core-backend/package.json` — add AdminJS/Fastify/session dependencies and remove anything unnecessary after the merge
- `apps/core-backend/src/server.ts` — register the AdminJS module and any required `/admin/*` setup/OIDC routes
- `apps/core-backend/src/config/env.ts` — validate admin session env vars and secure-cookie configuration
- `apps/core-backend/src/auth/auth-admin.service.ts` — expose or refine helpers needed by AdminJS auth/setup without routing through HTTP
- `apps/core-backend/src/auth/auth-oidc.service.ts` — expose or refine helpers needed by AdminJS OIDC login flow
- `apps/core-backend/test/admin.spec.ts` — replace bridge-endpoint tests with auth/setup/session regression coverage
- `package.json` — remove `admin-backend` scripts and stack commands
- `Makefile` — remove `admin-*` targets and update stack targets
- `docker-compose.yml` — remove the `admin-backend` service and move any required env into `core-backend`
- `.github/workflows/release.yml` — stop building/publishing the `admin-backend` image and update release notes text
- `README.md` — update admin startup/runtime docs and remove `/internal/admin/*` public references

**Create**

- `apps/core-backend/src/admin/build-admin.ts` — AdminJS construction, branding, root path, and resource registration
- `apps/core-backend/src/admin/auth-provider.ts` — AdminJS auth bridge that delegates to existing auth services
- `apps/core-backend/src/admin/session-store.ts` — Fastify session configuration for AdminJS, using a production-safe store
- `apps/core-backend/src/admin/dashboard.ts` — dashboard data helpers extracted from the old admin service
- `apps/core-backend/src/admin/resources/users.resource.ts` — user resource/actions using `authAdminService`
- `apps/core-backend/src/admin/resources/app-config.resource.ts` — editable config resource/actions using settings/storage/calendar services directly
- `apps/core-backend/src/admin/resources/oidc-provider.resource.ts` — OIDC provider resource/actions using `authOidcService`
- `apps/core-backend/src/admin/resources/read-only.resource.ts` — shared helpers for read-only AdminJS resources
- `apps/core-backend/src/admin/routes.ts` — only the `/admin/setup`, `/admin/login/oidc/:providerId`, and `/admin/login/oidc/callback` routes that still need explicit Fastify handlers
- `apps/core-backend/src/admin/components/dashboard.tsx` — moved dashboard component from `apps/admin-backend`
- `apps/core-backend/src/admin/components/plain-text.tsx` — moved AdminJS field component from `apps/admin-backend`

**Delete**

- `apps/admin-backend/package.json`
- `apps/admin-backend/tsconfig.json`
- `apps/admin-backend/Dockerfile`
- `apps/admin-backend/Dockerfile.dev`
- `apps/admin-backend/src/main.ts`
- `apps/admin-backend/src/session.d.ts`
- `apps/admin-backend/src/components/dashboard.tsx`
- `apps/admin-backend/src/components/plain-text.tsx`
- `apps/core-backend/src/routes/admin.ts`

## Target Endpoint Surface

**Keep / add**

- `/admin` — AdminJS root
- `/admin/login` — AdminJS login page
- `/admin/setup` — initial admin bootstrap flow
- `/admin/login/oidc/:providerId` — start admin OIDC flow
- `/admin/login/oidc/callback` — finish admin OIDC flow

**Delete once AdminJS is mounted in-process**

- `/internal/admin/bootstrap-status`
- `/internal/admin/auth/login`
- `/internal/admin/auth/oidc/providers`
- `/internal/admin/auth/oidc/start`
- `/internal/admin/auth/oidc/complete`
- `/internal/admin/setup-initial`
- `/internal/admin/me`
- `/internal/admin/settings`
- `/internal/admin/settings/account-creation-enabled`
- `/internal/admin/settings/password-auth-enabled`
- `/internal/admin/oidc/providers`
- `/internal/admin/oidc/providers/:providerId`
- `/internal/admin/users`
- `/internal/admin/users/:userId`
- `/internal/admin/storage/config`
- `/internal/admin/calendar/config`
- `/internal/admin/storage/migrate`
- `/internal/admin/storage/gc`

If an endpoint is not called by the merged AdminJS runtime, delete it. Do not keep compatibility shims “just in case.”

### Task 1: Move AdminJS Into Core Backend Without Changing Behavior Yet

**Files:**

- Modify: `apps/core-backend/package.json`
- Modify: `apps/core-backend/src/server.ts`
- Create: `apps/core-backend/src/admin/build-admin.ts`
- Create: `apps/core-backend/src/admin/dashboard.ts`
- Create: `apps/core-backend/src/admin/components/dashboard.tsx`
- Create: `apps/core-backend/src/admin/components/plain-text.tsx`

- [ ] **Step 1: Add a failing boot test that expects AdminJS to mount from `core-backend`**

Use a lightweight app bootstrap test in `apps/core-backend/test/admin.spec.ts` that checks the app starts with the admin module enabled and responds under `/admin`.

```ts
it("mounts the admin surface from core backend", async () => {
  const app = await buildApp({ logger: false });
  const response = await request(app.server).get("/admin");
  expect([200, 302]).toContain(response.status);
});
```

- [ ] **Step 2: Run the targeted admin test and confirm it fails before wiring AdminJS into Fastify**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: FAIL because `/admin` is not yet mounted by `core-backend`

- [ ] **Step 3: Add AdminJS dependencies to [package.json](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/package.json)**

Add:

- `adminjs`
- `@adminjs/fastify`
- `@adminjs/prisma`
- session dependencies chosen in Task 2
- `react` and `react-dom` only because AdminJS requires them

Do not add `express`, `express-session`, or `@adminjs/express`.

- [ ] **Step 4: Extract the existing AdminJS resource/component setup from `apps/admin-backend/src/main.ts` into focused core-backend files**

Move:

- dashboard component
- plain text component
- dashboard stats helper
- shared read-only action helpers

Keep the first pass behaviorally identical; only change file ownership and wiring.

- [ ] **Step 5: Register the AdminJS module in [server.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/server.ts)**

Expected flow:

```ts
await fastify.register(adminModule);
```

- [ ] **Step 6: Re-run the targeted test**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/core-backend/package.json apps/core-backend/src/server.ts apps/core-backend/src/admin apps/core-backend/test/admin.spec.ts
git commit -m "feat: mount adminjs from core backend"
```

### Task 2: Add Production-Safe Admin Session Handling

**Files:**

- Modify: `apps/core-backend/package.json`
- Modify: `apps/core-backend/src/config/env.ts`
- Create: `apps/core-backend/src/admin/session-store.ts`
- Create: `apps/core-backend/src/admin/auth-provider.ts`
- Modify: `apps/core-backend/test/admin.spec.ts`

- [ ] **Step 1: Add failing tests around password admin login through the new AdminJS auth bridge**

The tests should cover auth behavior, not HTML rendering:

```ts
it("authenticates admin credentials through the shared admin auth service", async () => {
  const currentAdmin = await authenticateAdmin("admin@example.com", "secret-pass");
  expect(currentAdmin).toMatchObject({ email: "admin@example.com" });
});

it("rejects non-admin or invalid credentials", async () => {
  await expect(authenticateAdmin("user@example.com", "bad-pass")).resolves.toBeNull();
});
```

- [ ] **Step 2: Run the focused admin tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: FAIL because the new auth bridge does not exist yet

- [ ] **Step 3: Implement the AdminJS auth provider by delegating to existing services**

In [auth-provider.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/admin/auth-provider.ts):

- call `authAdminService.createInternalAdminSession` for email/password login
- return the shape AdminJS expects for `currentAdmin`
- keep session payload minimal: `id`, `email`, `displayName`, `isAdmin`, plus access token only if AdminJS-specific callbacks require it

- [ ] **Step 4: Configure a production-safe Fastify session store**

Recommended path:

- use `@fastify/session`
- use a Postgres-backed store rather than default in-memory storage
- keep secure cookie settings in env-driven config
- set `httpOnly`, `sameSite`, and `secure` correctly for production

The session module should be created in [session-store.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/admin/session-store.ts) and consumed by the AdminJS registration.

- [ ] **Step 5: Add env validation for admin session secrets and cookie behavior**

Examples:

- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_COOKIE_NAME`
- secure-cookie behavior tied to environment / proxy settings

- [ ] **Step 6: Re-run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/core-backend/package.json apps/core-backend/src/config/env.ts apps/core-backend/src/admin/session-store.ts apps/core-backend/src/admin/auth-provider.ts apps/core-backend/test/admin.spec.ts
git commit -m "feat: add secure adminjs auth bridge"
```

### Task 3: Reuse Existing OIDC Logic Under `/admin/*`

**Files:**

- Modify: `apps/core-backend/src/auth/auth-oidc.service.ts`
- Create: `apps/core-backend/src/admin/routes.ts`
- Modify: `apps/core-backend/src/server.ts`
- Modify: `apps/core-backend/test/admin.spec.ts`

- [ ] **Step 1: Add failing tests for admin OIDC start and callback flow**

Focus on route behavior and service calls, not page rendering:

- `/admin/login/oidc/:providerId` starts the flow
- `/admin/login/oidc/callback` completes the flow
- successful completion establishes the same AdminJS session shape as password login

- [ ] **Step 2: Run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: FAIL until the new `/admin/*` OIDC routes are wired

- [ ] **Step 3: Implement only the Fastify routes still required outside AdminJS**

Create [routes.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/admin/routes.ts) with:

- `GET /admin/setup`
- `POST /admin/setup`
- `GET /admin/login/oidc/:providerId`
- `GET /admin/login/oidc/callback`

Rules:

- call existing services directly, not via `fetch`
- store the authenticated admin into the AdminJS session on success
- redirect back to `/admin`
- keep setup unavailable after the first admin exists

- [ ] **Step 4: Re-run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Manual smoke check**

Run: `npm run start:dev --workspace @slate/core-backend`
Expected:

- `/admin` shows the AdminJS login flow
- `/admin/setup` works only before initial bootstrap
- OIDC redirect/callback flow lands back in the AdminJS session

- [ ] **Step 6: Commit**

```bash
git add apps/core-backend/src/auth/auth-oidc.service.ts apps/core-backend/src/admin/routes.ts apps/core-backend/src/server.ts apps/core-backend/test/admin.spec.ts
git commit -m "feat: wire adminjs oidc and setup routes"
```

### Task 4: Convert Resource Actions To In-Process Service Calls

**Files:**

- Create: `apps/core-backend/src/admin/resources/read-only.resource.ts`
- Create: `apps/core-backend/src/admin/resources/users.resource.ts`
- Create: `apps/core-backend/src/admin/resources/app-config.resource.ts`
- Create: `apps/core-backend/src/admin/resources/oidc-provider.resource.ts`
- Modify: `apps/core-backend/src/admin/build-admin.ts`
- Modify: `apps/core-backend/test/admin.spec.ts`

- [ ] **Step 1: Add failing tests for the custom business operations that must keep working after route deletion**

Cover at least:

- create/update admin-managed user
- toggle password auth
- update storage config and reinitialize storage
- update calendar config
- create/update/delete OIDC provider
- run storage garbage collection

These tests should call the extracted action helpers or underlying services directly. Do not add browser/UI tests.

- [ ] **Step 2: Run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: FAIL where action helpers do not yet exist

- [ ] **Step 3: Replace all `coreRequest("/internal/admin/...")` action handlers with direct service or Prisma calls**

Mapping:

- user create/edit actions -> `authAdminService.upsertAdminManagedUser`
- AppConfig edits -> `settingsService`, `storageService`, and calendar helpers
- OIDC provider actions -> `authOidcService`
- garbage collection action -> `jobHandlers.runGarbageCollection`
- dashboard loader -> Prisma counts + extracted helper functions

- [ ] **Step 4: Keep resource definitions small and explicit**

Prefer focused files so `build-admin.ts` mainly assembles:

```ts
resources: [
  buildUsersResource(deps),
  buildAppConfigResource(deps),
  buildOidcProviderResource(deps),
  ...buildReadOnlyResources(deps),
];
```

- [ ] **Step 5: Re-run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-backend/src/admin apps/core-backend/test/admin.spec.ts
git commit -m "refactor: make adminjs actions call services directly"
```

### Task 5: Delete Legacy `/internal/admin/*` Bridge Endpoints

**Files:**

- Delete: `apps/core-backend/src/routes/admin.ts`
- Modify: `apps/core-backend/src/server.ts`
- Modify: `apps/core-backend/test/admin.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add a failing assertion that the legacy bridge routes are gone after migration**

Examples:

```ts
it("does not expose legacy internal admin bridge routes", async () => {
  const app = await buildApp({ logger: false });
  await request(app.server).get("/internal/admin/bootstrap-status").expect(404);
  await request(app.server).post("/internal/admin/auth/login").send({}).expect(404);
});
```

- [ ] **Step 2: Remove the old route registration from [server.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/server.ts)**

Delete:

```ts
import adminRoutes from "./routes/admin";
await fastify.register(adminRoutes);
```

- [ ] **Step 3: Delete [admin.ts](/Users/jasongiroux/Desktop/git/slate/apps/core-backend/src/routes/admin.ts)**

No compatibility layer. No deprecated aliases. No dead endpoints left behind.

- [ ] **Step 4: Update docs to point to `/admin` only**

In [README.md](/Users/jasongiroux/Desktop/git/slate/README.md):

- remove mentions of calling `/internal/admin/*` externally
- document the merged admin runtime and required env vars

- [ ] **Step 5: Re-run the focused tests**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-backend/src/server.ts apps/core-backend/test/admin.spec.ts README.md
git rm apps/core-backend/src/routes/admin.ts
git commit -m "refactor: remove legacy internal admin bridge routes"
```

### Task 6: Remove The Separate Admin Service From Dev, Docker, And Release

**Files:**

- Modify: `package.json`
- Modify: `Makefile`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/release.yml`
- Delete: `apps/admin-backend/package.json`
- Delete: `apps/admin-backend/tsconfig.json`
- Delete: `apps/admin-backend/Dockerfile`
- Delete: `apps/admin-backend/Dockerfile.dev`
- Delete: `apps/admin-backend/src/main.ts`
- Delete: `apps/admin-backend/src/session.d.ts`
- Delete: `apps/admin-backend/src/components/dashboard.tsx`
- Delete: `apps/admin-backend/src/components/plain-text.tsx`

- [ ] **Step 1: Remove root scripts and make targets that mention `admin-backend`**

Update [package.json](/Users/jasongiroux/Desktop/git/slate/package.json) and [Makefile](/Users/jasongiroux/Desktop/git/slate/Makefile):

- delete `dev:admin-backend`, `admin:up`, `admin:logs`
- simplify `stack:up` and `stack:logs` to only the merged backend

- [ ] **Step 2: Remove the `admin-backend` service from [docker-compose.yml](/Users/jasongiroux/Desktop/git/slate/docker-compose.yml)**

Expected remaining services:

- `postgres`
- `core-backend`
- `minio`

- [ ] **Step 3: Remove `admin-backend` from the release workflow**

Update [release.yml](/Users/jasongiroux/Desktop/git/slate/.github/workflows/release.yml):

- image matrix becomes `app: [core-backend]`
- release notes only mention `slate-core-backend`

- [ ] **Step 4: Delete the old workspace files**

Use `apply_patch` deletions for the package files under `apps/admin-backend`.

- [ ] **Step 5: Verify workspace/build metadata still works**

Run: `npm run lint --workspace @slate/core-backend`
Expected: PASS

Run: `npm run build --workspace @slate/core-backend`
Expected: PASS

Run: `npm run start:dev --workspace @slate/core-backend`
Expected: PASS with `/admin` served from the merged backend

- [ ] **Step 6: Commit**

```bash
git add package.json Makefile docker-compose.yml .github/workflows/release.yml apps/core-backend
git rm -r apps/admin-backend
git commit -m "refactor: remove separate admin backend package"
```

### Task 7: Final Regression And Cleanup Sweep

**Files:**

- Modify as needed: `README.md`
- Test: `apps/core-backend/test/admin.spec.ts`

- [ ] **Step 1: Run the focused admin/auth regression suite**

Run: `npm run test --workspace @slate/core-backend -- test/admin.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 2: Run the broader backend suite**

Run: `npm run test --workspace @slate/core-backend -- --runInBand`
Expected: PASS

- [ ] **Step 3: Smoke test the merged runtime**

Run: `docker compose up -d postgres minio core-backend`
Expected:

- `http://localhost:4000/health` succeeds
- `http://localhost:4000/admin` works without any admin container

- [ ] **Step 4: Confirm no stale route references remain**

Run: `rg -n "@slate/admin-backend|apps/admin-backend|slate-admin-backend|/internal/admin/" .`
Expected:

- no code references to `apps/admin-backend`
- no runtime code references to `/internal/admin/`
- docs updated to `/admin`

- [ ] **Step 5: Commit any final cleanup**

```bash
git add -A
git commit -m "test: verify merged adminjs runtime cleanup"
```

## Notes For The Implementer

- The framework choice is settled: keep AdminJS, but run it inside Fastify with `@adminjs/fastify`.
- Reuse existing auth logic as services, not as HTTP bridge endpoints.
- Prefer deleting `/internal/admin/*` entirely over preserving “temporary” compatibility routes.
- Do not add UI tests for AdminJS pages. Cover auth/setup/resource behavior at the service/route/helper level and use manual smoke checks for the browser experience.
- Keep the security posture better than the current Express setup: no in-memory production session store, secure cookies, and explicit env validation.
