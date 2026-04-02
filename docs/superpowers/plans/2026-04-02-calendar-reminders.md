# Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop reminder notifications and optional sound X minutes before calendar events start, using local sqlite-backed settings and an Electron-main scheduler.

**Architecture:** Keep reminder scheduling in Electron main so notifications can fire independently of the React calendar screen. Persist reminder preferences and fired-reminder dedupe state in `MetadataStore`, reuse the existing calendar fetch path through `BackendClient`, and expose only reminder settings/configuration to the renderer.

**Tech Stack:** Electron main IPC, native Electron `Notification`, `MetadataStore` sqlite settings, existing desktop calendar IPC/API layer, React settings UI, Jest/source regression tests.

---

## File Structure

- Create: `apps/desktop/electron/services/calendar-reminder-service.mjs`
  Responsible for polling upcoming events, computing due reminders, deduping fired reminders, and triggering native notifications/sound.
- Create: `apps/desktop/electron/services/calendar-reminder-service.test.mjs`
  Focused behavior tests for scheduling, dedupe, and payload handling.
- Modify: `apps/desktop/electron/services/metadata-store.mjs`
  Add settings access patterns for reminder preferences and fired reminder records.
- Modify: `apps/desktop/electron/main.mjs`
  Instantiate the reminder service, wire lifecycle hooks, and expose reminder settings IPC.
- Modify: `apps/desktop/electron/preload.mjs`
  Expose reminder settings methods to the renderer.
- Modify: `apps/desktop/src/lib/api.ts`
  Add typed desktop API methods and exported helpers for reminder settings.
- Modify: `apps/desktop/src/App.tsx`
  Load and persist reminder settings with other local desktop settings.
- Modify: `apps/desktop/src/components/SettingsDialog.tsx`
  Add reminder settings UI.
- Modify: `apps/desktop/electron/services/calendar-ui-persistence.test.mjs`
  Extend source-regression coverage for reminder settings IPC and renderer usage.

## Data Model

- `CalendarReminderSettings`
  - `enabled: boolean`
  - `minutesBeforeStart: number`
  - `playSound: boolean`
  - `enabledCalendarIds?: string[]`
- `FiredReminderRecord`
  - dedupe key format: `${event.id}:${event.startTime}:${minutesBeforeStart}`
  - value stores `firedAt`

## Behavior Rules

- Reminders fire only for upcoming events whose start time falls within the configured reminder lead time.
- Read-only and ICS events may notify if they are visible and reminders are enabled for their source.
- Notifications are desktop-local only; no backend schema changes.
- The scheduler must survive renderer reloads and continue working while the app window stays open.
- Dedupe state prevents repeat notifications for the same event instance and reminder offset.
- On startup, wake, and periodic refresh, the scheduler recomputes due reminders.
- If backend auth/connectivity is unavailable, the scheduler should skip fetches quietly and retry on the next cycle.

### Task 1: Add reminder settings and dedupe persistence

**Files:**
- Modify: `apps/desktop/electron/services/metadata-store.mjs`

- [ ] **Step 1: Add reminder settings defaults**

Add helper methods or constants for:
- `calendarReminderSettings`
- `calendarReminderFired`

Default settings:

```js
{
  enabled: false,
  minutesBeforeStart: 10,
  playSound: true,
  enabledCalendarIds: null
}
```

- [ ] **Step 2: Add fired reminder cleanup behavior**

Store dedupe records in settings, but prune old entries when reading/writing so the settings table does not grow forever.

Retention rule:
- keep only entries for the last 14 days

- [ ] **Step 3: Add focused tests if the repo already has metadata-store coverage**

If there is existing coverage for `MetadataStore`, add tests there. Otherwise keep this behavior covered through the reminder service test file.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/services/metadata-store.mjs
git commit -m "feat: add calendar reminder metadata settings"
```

### Task 2: Add Electron-main reminder service

**Files:**
- Create: `apps/desktop/electron/services/calendar-reminder-service.mjs`
- Test: `apps/desktop/electron/services/calendar-reminder-service.test.mjs`

- [ ] **Step 1: Write the failing reminder service tests**

Cover:
- due reminder fires once for matching event window
- duplicate scan does not fire the same reminder twice
- stale fired reminders are ignored/pruned
- disabled reminders do not fire
- backend fetch failure does not crash the service

- [ ] **Step 2: Run the reminder service test to verify it fails**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-reminder-service.test.mjs
```

Expected:
- FAIL because the reminder service does not exist yet

- [ ] **Step 3: Implement the reminder service**

Implement a service with:
- constructor dependencies:
  - `backendClient`
  - `metadataStore`
  - `Notification`
  - optional `soundPlayer` wrapper
- methods:
  - `start()`
  - `stop()`
  - `refreshNow()`
  - `handleWake()`
- polling interval:
  - every 60 seconds
- event fetch window:
  - from now to now + max(`minutesBeforeStart`, 60) minutes
- source filtering:
  - use persisted enabled calendar ids if configured

Notification payload:

```js
new Notification({
  title: event.title || "Upcoming event",
  body: `${calendarName} • ${formattedTime}`,
  silent: !settings.playSound,
})
```

Sound behavior:
- Prefer native notification sound when available
- If `playSound` is true and native notification sound is unreliable, call `shell.beep()` as fallback

- [ ] **Step 4: Run the reminder service test to verify it passes**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-reminder-service.test.mjs
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/services/calendar-reminder-service.mjs apps/desktop/electron/services/calendar-reminder-service.test.mjs
git commit -m "feat: add desktop calendar reminder service"
```

### Task 3: Wire the reminder service into Electron app lifecycle

**Files:**
- Modify: `apps/desktop/electron/main.mjs`

- [ ] **Step 1: Instantiate the reminder service after backend and metadata services are created**

Wire it alongside the existing desktop services.

- [ ] **Step 2: Start and stop the service with the app lifecycle**

Hook into:
- app ready / window creation
- app quit

- [ ] **Step 3: Refresh reminders on state changes that matter**

Trigger `refreshNow()` when:
- backend auth state changes
- calendar settings change
- app resumes from sleep via Electron `powerMonitor.on("resume")`

- [ ] **Step 4: Keep the service independent of current UI tab**

Do not tie reminders to `sidebarMode` or whether the calendar view is mounted.

- [ ] **Step 5: Run the desktop reminder tests**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-reminder-service.test.mjs
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main.mjs
git commit -m "feat: wire calendar reminders into desktop lifecycle"
```

### Task 4: Expose reminder settings through IPC and typed desktop API

**Files:**
- Modify: `apps/desktop/electron/main.mjs`
- Modify: `apps/desktop/electron/preload.mjs`
- Modify: `apps/desktop/src/lib/api.ts`
- Test: `apps/desktop/electron/services/calendar-ui-persistence.test.mjs`

- [ ] **Step 1: Add new IPC handlers**

Add:
- `desktop:getCalendarReminderSettings`
- `desktop:setCalendarReminderSettings`

- [ ] **Step 2: Add preload bridge methods**

Expose the same methods through `contextBridge`.

- [ ] **Step 3: Add typed API helpers**

Add:

```ts
export interface CalendarReminderSettings {
  enabled: boolean;
  minutesBeforeStart: number;
  playSound: boolean;
  enabledCalendarIds: string[] | null;
}
```

and corresponding exported helpers in `src/lib/api.ts`.

- [ ] **Step 4: Extend source-regression coverage**

Update `calendar-ui-persistence.test.mjs` to assert the new IPC and API seams exist.

- [ ] **Step 5: Run the persistence regression test**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-ui-persistence.test.mjs
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main.mjs apps/desktop/electron/preload.mjs apps/desktop/src/lib/api.ts apps/desktop/electron/services/calendar-ui-persistence.test.mjs
git commit -m "feat: expose calendar reminder settings"
```

### Task 5: Load and persist reminder settings in the renderer

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Load reminder settings during app initialization**

Fetch them alongside:
- `getLastOpenNoteId`
- `getLastSidebarMode`
- `getCalendarVisibilityFilters`

- [ ] **Step 2: Hold reminder settings in local app state**

Persist changes immediately with the existing desktop settings pattern.

- [ ] **Step 3: Feed reminder-enabled calendar ids from current calendar status**

Provide sensible defaults:
- if `enabledCalendarIds` is `null`, all enabled subscribed calendars and ICS feeds are eligible

- [ ] **Step 4: Refresh the Electron reminder service after settings changes**

If the IPC setter does not already trigger this in main, add a dedicated refresh call or ensure the setter path causes a scheduler refresh.

- [ ] **Step 5: Add renderer regression coverage if useful**

Extend source checks to verify initialization and persistence calls are present.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: load calendar reminder settings in app state"
```

### Task 6: Add reminder controls to Settings

**Files:**
- Modify: `apps/desktop/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Add reminder settings UI**

Add controls for:
- enable reminders toggle
- minutes-before-start select/input
- play sound toggle

Suggested minute presets:
- 1
- 5
- 10
- 15
- 30

- [ ] **Step 2: Use existing settings UI patterns**

Do not create a special calendar settings layout. Reuse the existing settings row/section controls already in the dialog.

- [ ] **Step 3: Add copy**

Use concise copy:
- `Remind me before events`
- `Minutes before start`
- `Play sound`

- [ ] **Step 4: Disable dependent controls when reminders are off**

Minutes and sound controls should be disabled when `enabled === false`.

- [ ] **Step 5: Run the desktop build or targeted renderer checks**

Run:

```bash
npm run build --workspace @slate/desktop
```

Expected:
- PASS, or if there are known unrelated TS failures in this branch, document them and run the narrowest passing reminder-related test coverage instead

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/SettingsDialog.tsx
git commit -m "feat: add calendar reminder settings UI"
```

### Task 7: Hardening and edge-case coverage

**Files:**
- Modify: `apps/desktop/electron/services/calendar-reminder-service.mjs`
- Modify: `apps/desktop/electron/services/calendar-reminder-service.test.mjs`

- [ ] **Step 1: Add edge-case tests**

Cover:
- all-day events
- recurring events returned as separate instances
- event time changes after one reminder already fired
- disabled calendar sources should not notify
- renderer reload does not clear fired dedupe state

- [ ] **Step 2: Implement only the minimal hardening needed to pass**

Prefer dedupe keying by:

```txt
event.id + startTime + minutesBeforeStart
```

so changed instances can still notify once at their new start time.

- [ ] **Step 3: Run all reminder-related desktop tests**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-reminder-service.test.mjs calendar-ui-persistence.test.mjs
```

Expected:
- PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/services/calendar-reminder-service.mjs apps/desktop/electron/services/calendar-reminder-service.test.mjs apps/desktop/electron/services/calendar-ui-persistence.test.mjs
git commit -m "test: harden calendar reminder behavior"
```

### Task 8: Final verification

**Files:**
- No new files

- [ ] **Step 1: Run targeted desktop tests**

Run:

```bash
npm run test --workspace @slate/desktop -- calendar-reminder-service.test.mjs calendar-ui-persistence.test.mjs backend-client-calendar.test.mjs
```

Expected:
- PASS

- [ ] **Step 2: Run desktop build**

Run:

```bash
npm run build --workspace @slate/desktop
```

Expected:
- PASS, or document any unrelated existing build blockers if this branch still has pre-existing failures

- [ ] **Step 3: Manual smoke check**

Verify:
- app launch with reminders enabled
- notification fires once for a test event a few minutes away
- sound toggle works
- sleep/wake resumes reminder scanning
- changing reminder minutes updates behavior without restart

- [ ] **Step 4: Commit final integration**

```bash
git add apps/desktop/electron/services/calendar-reminder-service.mjs apps/desktop/electron/services/calendar-reminder-service.test.mjs apps/desktop/electron/services/metadata-store.mjs apps/desktop/electron/main.mjs apps/desktop/electron/preload.mjs apps/desktop/src/lib/api.ts apps/desktop/src/App.tsx apps/desktop/src/components/SettingsDialog.tsx apps/desktop/electron/services/calendar-ui-persistence.test.mjs
git commit -m "feat: add desktop calendar reminders"
```

## Notes For The Implementer

- Keep the scheduler in Electron main, not the renderer.
- Do not add backend persistence or server-side reminder jobs.
- Reuse existing calendar fetch APIs instead of introducing a new reminder endpoint.
- Treat notification sound as best-effort and platform-dependent.
- Prefer small focused helpers over adding more reminder logic into `main.mjs` directly.
