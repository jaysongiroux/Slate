# Settings Dialog Storage/Server Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the desktop settings dialog so it reflects sqlite + IndexedDB local storage and REST server connectivity instead of root-folder settings and gRPC-oriented copy.

**Architecture:** Keep the refactor tightly scoped to the existing settings UI and props. Reuse the current import, authentication, and connection handlers, but rename and rewrite the sections so the interface matches the current storage and sync architecture without changing the underlying behavior.

**Tech Stack:** React, TypeScript, existing desktop UI components, Vite build/typecheck

---

### Task 1: Refresh settings information architecture and copy

**Files:**

- Modify: `apps/desktop/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Write the failing check**

Confirm the current dialog still contains outdated concepts:

- `Workspace`
- `Root folder`
- `Choose root folder`
- `localhost:50051`
- gRPC-style host/port helper copy

- [ ] **Step 2: Verify the outdated strings are present**

Run: `rg -n "Workspace|Root folder|Choose root folder|localhost:50051|Host and port" apps/desktop/src/components/SettingsDialog.tsx`
Expected: Matches found in the current component.

- [ ] **Step 3: Write the minimal implementation**

Update the dialog to:

- Rename `Workspace` to `Storage`
- Rename `Backend` to `Server`
- Remove the root-folder display and chooser button
- Keep markdown import, but reframe it as a legacy migration/import flow into local storage
- Add explanatory storage copy for sqlite + IndexedDB
- Update server helper copy, placeholders, and status text to reflect a REST API endpoint

- [ ] **Step 4: Verify the outdated strings are gone**

Run: `rg -n "Root folder|Choose root folder|localhost:50051|Host and port" apps/desktop/src/components/SettingsDialog.tsx`
Expected: No matches.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/SettingsDialog.tsx
git commit -m "refactor: refresh desktop settings copy"
```

### Task 2: Align fallback endpoint defaults with the dialog

**Files:**

- Modify: `apps/desktop/src/lib/api.ts`

- [ ] **Step 1: Write the failing check**

Confirm browser fallback responses still expose the old endpoint default.

- [ ] **Step 2: Verify it fails the new expectation**

Run: `rg -n "50051" apps/desktop/src/lib/api.ts`
Expected: Matches found in browser fallback backend responses.

- [ ] **Step 3: Write the minimal implementation**

Replace stale fallback endpoint values with `localhost:4000` so preview/fallback behavior matches the desktop app and updated settings copy.

- [ ] **Step 4: Verify the new expectation**

Run: `rg -n "50051" apps/desktop/src/lib/api.ts`
Expected: No matches.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/api.ts
git commit -m "chore: align desktop fallback endpoint"
```

### Task 3: Verify the desktop app still builds

**Files:**

- Verify: `apps/desktop/package.json`

- [ ] **Step 1: Run the desktop build/typecheck**

Run: `npm run build --workspace @slate/desktop`
Expected: TypeScript and Vite build succeed.

- [ ] **Step 2: Review results**

If the build fails, fix only issues caused by this refactor and rerun the same command.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-07-settings-dialog-storage-server-refresh.md apps/desktop/src/components/SettingsDialog.tsx apps/desktop/src/lib/api.ts
git commit -m "refactor: update desktop settings architecture copy"
```
