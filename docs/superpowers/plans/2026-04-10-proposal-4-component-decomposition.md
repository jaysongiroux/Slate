# Proposal 4: Component Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose oversized desktop renderer files (`App.tsx`, `ChatSidebar.tsx`, `CalendarView.tsx`, `api.ts`, and related dialogs) into focused modules under ~500 lines each, with centralized UI/app state in Zustand and clearer feature boundaries.

**Architecture:** Introduce three Zustand stores (`app-store`, `ui-store`, `sync-store`) to replace the bulk of `useState` orchestration in `App.tsx`, while keeping `SyncProvider` as the owner of Yjs/Hocuspocus lifecycle (sync-store mirrors connection/save flags that today leak into App). Extract route-level shells (`NotesView`, `ChatView`, calendar layout) and a `DialogManager` so `App` becomes composition only. Split `lib/api.ts` by domain with a barrel `lib/api/index.ts`. Heavy async bootstrap (snapshot load, backend polling) should live in small hooks that **write into stores** or call existing IPC—avoid duplicating logic inside store actions beyond thin setters.

**Tech Stack:** React 19, TypeScript, Vite, Electron, Zustand (new dependency for `@slate/desktop`), existing `@dnd-kit`, TipTap/novel, `sonner`.

## Why Zustand (from `docs/simplification-analysis.md`)

**Problem:** Dozens of `useState` hooks in `App.tsx`, with state passed through props and context—hard to follow and refactor.

**Why Zustand over alternatives:**

| Library       | Bundle size | Boilerplate | Learning curve |
| ------------- | ----------- | ----------- | -------------- |
| Zustand       | ~1.1 KB     | Minimal     | Trivial        |
| Redux Toolkit | ~11 KB      | Medium      | Medium         |
| Jotai         | ~2.4 KB     | Minimal     | Low            |
| MobX          | ~16 KB      | Medium      | Medium         |

Zustand fits this app: tiny, no extra providers for global UI state, works with React 19, API is plain functions and selectors.

**Shape (illustrative):**

```typescript
// stores/app-store.ts — pattern used in this plan
export const useAppStore = create<AppState>((set) => ({
  selectedNoteId: "",
  sidebarMode: "notes",
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),
  setSidebarMode: (mode) => set({ sidebarMode: mode }),
}));
```

**Related work:** `docs/superpowers/plans/2026-04-09-v1-stabilization.md` already sketches hooks (`useWorkspaceBootstrap`, `useBackendConnection`, etc.). **Pick one sequencing strategy before starting:**

- **A (recommended):** Execute Proposal 4 store + shell extraction first; fold stabilization hooks into the new files as you touch them.
- **B:** Land stabilization hooks in `App.tsx` first, then migrate their state into Zustand in a follow-up pass.

---

## Decisions to confirm (human)

1. **Sequencing:** Choose A or B above so two agents do not fight over `App.tsx`.
2. **Line budget:** Is ~500 lines a hard cap per file or a target (allow occasional 600 if boundaries stay clear)?
3. **Renderer tests:** This repo’s desktop `test` script only runs `electron/services/*.test.mjs`. Adding Vitest for Zustand stores is optional; Task 1 includes it as the default verification path for store logic.

---

## File structure

### New directories and files (`apps/desktop/src`)

| Path                                                                                                           | Responsibility                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `stores/app-store.ts`                                                                                          | `sidebarMode`, `mainPanelMode`, `selectedNoteId`, calendar view/date, search UI indices, tree selection/collapse (if still global) |
| `stores/ui-store.ts`                                                                                           | Dialog open flags + transient dialog payloads (settings, bulk delete, rename, ICS, events, command bar, search open/close)         |
| `stores/sync-store.ts`                                                                                         | `saveState`, `backendSyncing`, `connectionStatus`, `connectionError`, `backendEndpoint` mirror (or pointers into existing types)   |
| `components/AppShell.tsx`                                                                                      | `SyncProvider` wrapper + `DesktopShell` + `IconRail` + slot for main content                                                       |
| `components/MainContent.tsx`                                                                                   | Switch on `sidebarMode` / `mainPanelMode`; mounts `NotesView`, `ChatSidebar`, calendar layout                                      |
| `features/notes/NotesView.tsx`                                                                                 | Note tree column + editor column + note DnD wiring currently inline in `App`                                                       |
| `features/chat/ChatView.tsx`                                                                                   | Layout wrapper if chat needs a top-level shell distinct from `ChatSidebar`                                                         |
| `features/calendar/CalendarLayout.tsx`                                                                         | Sidebar + `CalendarView` composition moved out of `App`                                                                            |
| `components/dialogs/DialogManager.tsx`                                                                         | Renders dialogs based on `ui-store`; receives stable action callbacks from parent or hooks                                         |
| `components/dialogs/settings/`                                                                                 | Split from `SettingsDialog.tsx` (panels as listed in simplification doc)                                                           |
| `features/chat/ConversationList.tsx`, `ChatMessages.tsx`, `ChatInput.tsx`, `hooks/use-chat.ts`                 | Decomposition of `ChatSidebar.tsx`                                                                                                 |
| `features/calendar/MonthGrid.tsx`, `WeekView.tsx`, `DayView.tsx`, `EventCard.tsx`, `hooks/use-calendar.ts`     | Decomposition of `CalendarView.tsx`                                                                                                |
| `lib/api/index.ts`                                                                                             | Re-exports                                                                                                                         |
| `lib/api/notes-api.ts`, `calendar-api.ts`, `ai-api.ts`, `auth-api.ts`, `attachments-api.ts`, `settings-api.ts` | IPC groupings split from `lib/api.ts`                                                                                              |

### Modified (high touch)

- `apps/desktop/package.json` — add `zustand`; optionally `vitest`, `@vitest/coverage-v8`, `jsdom` for store tests
- `apps/desktop/vite.config.ts` — vitest `test` block if Task 1 adds renderer/store tests
- `apps/desktop/src/App.tsx` — shrink to shell composition
- `apps/desktop/src/components/ChatSidebar.tsx`, `CalendarView.tsx`, `SettingsDialog.tsx`, `NoteTree.tsx`, `NovelEditor.tsx`, `CalendarSidebar.tsx` — move or trim per tasks below
- `apps/desktop/src/lib/api.ts` — delete after split + barrel in place (or keep thin re-export file at old path for one release—prefer barrel only)

### Verification (every task that touches renderer)

Run from repo root:

```bash
npm run lint --workspace @slate/desktop
npm run build --workspace @slate/desktop
```

Expected: `tsc --noEmit` and `vite build` succeed with no new errors.

---

### Task 1: Add Zustand and store skeletons

**Files:**

- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/stores/app-store.ts`
- Create: `apps/desktop/src/stores/ui-store.ts`
- Create: `apps/desktop/src/stores/sync-store.ts`
- Modify: `apps/desktop/vite.config.ts` (optional Vitest)
- Create: `apps/desktop/src/stores/app-store.test.ts` (optional; skip sub-steps if you chose no Vitest)

- [ ] **Step 1: Add dependency**

```bash
npm install zustand --workspace @slate/desktop
```

- [ ] **Step 2: Implement `app-store`**

Create `apps/desktop/src/stores/app-store.ts`:

```typescript
import { create } from "zustand";
import type { SidebarMode } from "../components/IconRail";
import type { CalendarViewType } from "../components/CalendarView";

export type MainPanelMode = "notes" | "calendar";

type AppState = {
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  mainPanelMode: MainPanelMode;
  setMainPanelMode: (mode: MainPanelMode) => void;
  selectedNoteId: string;
  setSelectedNoteId: (id: string) => void;
  calendarView: CalendarViewType;
  setCalendarView: (v: CalendarViewType) => void;
  calendarDate: Date;
  setCalendarDate: (d: Date) => void;
};

export const useAppStore = create<AppState>((set) => ({
  sidebarMode: "notes",
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  mainPanelMode: "notes",
  setMainPanelMode: (mainPanelMode) => set({ mainPanelMode }),
  selectedNoteId: "",
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
  calendarView: "month",
  setCalendarView: (calendarView) => set({ calendarView }),
  calendarDate: new Date(),
  setCalendarDate: (calendarDate) => set({ calendarDate }),
}));
```

Adjust imports if you relocate `CalendarViewType` or `SidebarMode` to `types.ts` during refactors.

- [ ] **Step 3: Implement `ui-store` skeleton**

Create `apps/desktop/src/stores/ui-store.ts` with boolean open flags matching current `App.tsx` dialog state: `settingsOpen`, `commandBarOpen`, `searchOpen`, `addIcsOpen`, `createEventOpen`, `editEventOpen`, plus payload slots for rename/delete/event editing (mirror existing state shapes from `App.tsx` lines ~247–283).

- [ ] **Step 4: Implement `sync-store` skeleton**

Create `apps/desktop/src/stores/sync-store.ts` with fields aligned to `App.tsx`: `saveState`, `backendSyncing`, `connectionStatus`, `connectionError`, `backendEndpoint` — use the same `ConnectionStatus` type from `./components/SettingsDialog`.

- [ ] **Step 5: Wire one pilot field in `App.tsx`**

Replace `const [sidebarMode, setSidebarMode] = useState<SidebarMode>("notes")` with `useAppStore` selectors and setters. Confirm all `setSidebarMode` call sites use the store.

- [ ] **Step 6: Verify**

Run lint and build (commands above). Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/stores apps/desktop/src/App.tsx
git commit -m "feat(desktop): add Zustand stores and migrate sidebarMode"
```

---

### Task 2: Migrate remaining App state into stores

**Files:**

- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/stores/app-store.ts`
- Modify: `apps/desktop/src/stores/ui-store.ts`
- Modify: `apps/desktop/src/stores/sync-store.ts`

- [ ] **Step 1: Move calendar + main panel + selected note id**

Migrate `mainPanelMode`, `calendarView`, `calendarDate`, `selectedNoteId` from `useState` to `useAppStore`. Persisted prefs (`getLastSidebarMode`, `setLastOpenNoteId`, etc.) stay in `useEffect` in `App` or a future `useWorkspaceBootstrap` hook, but they **set store** instead of local state.

- [ ] **Step 2: Move dialog cluster to `ui-store`**

Migrate: `settingsOpen`, `commandBarOpen`, `searchOpen`/`searchClosing`/`searchQuery`/`searchIndex`/`searchCount`, folder/note/ICS rename dialogs, delete dialogs, `addIcsOpen`, `createEventOpen`/`createEventSlot`, `editEventOpen`/`editingEvent`.

- [ ] **Step 3: Move connection + save cluster to `sync-store`**

Migrate: `connectionStatus`, `connectionError`, `backendEndpoint`, `saveState`, `backendSyncing`, auth form fields if they remain global (or colocate in `SettingsDialog` local state if only used there—prefer local state for fields that do not need App-wide access).

- [ ] **Step 4: Leave tree/editor-specific state**

`collapsedPaths`, `selectedItems`, `snapshot`, `appLoading`, `selectedNote`, `errorMessage`, and refs (`chatSidebarRef`) may stay in `App` or move with `NotesView` extraction in Task 3—do not block Task 2 on perfect placement.

- [ ] **Step 5: Verify + commit**

Lint/build; then `git commit -m "refactor(desktop): move App orchestration state into Zustand stores"`.

---

### Task 3: Extract `AppShell`, `MainContent`, and feature shells

**Files:**

- Create: `apps/desktop/src/components/AppShell.tsx`
- Create: `apps/desktop/src/components/MainContent.tsx`
- Create: `apps/desktop/src/features/notes/NotesView.tsx`
- Create: `apps/desktop/src/features/calendar/CalendarLayout.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: `AppShell`**

Move `SyncProvider` + `DesktopShell` + top-level `Toaster` + `IconRail` wiring into `AppShell.tsx`. Props: `children` for main column, same props `SyncProvider` needs today (`noteId`, `backendUrl`, `getToken`).

- [ ] **Step 2: `MainContent`**

Implement mode switching currently in `App` JSX (notes vs calendar vs chat) using `useAppStore` for `sidebarMode` / `mainPanelMode`.

- [ ] **Step 3: `NotesView`**

Cut the note-tree + editor + empty state + note DnD `DndContext` subtree from `App.tsx` into `features/notes/NotesView.tsx`. Pass IPC handlers as props or import from a small `useNoteActions` hook if you introduce one.

- [ ] **Step 4: `CalendarLayout`**

Cut calendar sidebar + `CalendarView` + event dialogs mount points into `features/calendar/CalendarLayout.tsx`.

- [ ] **Step 5: Slim `App`**

`App.tsx` should approximate:

```tsx
function App() {
  return (
    <AppShell ...>
      <MainContent />
      <DialogManager />
    </AppShell>
  );
}
```

(Exact props depend on how much remains in `App` after Task 4.)

- [ ] **Step 6: Verify + commit**

Lint/build; commit `refactor(desktop): extract AppShell, MainContent, NotesView, CalendarLayout`.

---

### Task 4: `DialogManager` and settings panel split

**Files:**

- Create: `apps/desktop/src/components/dialogs/DialogManager.tsx`
- Create: `apps/desktop/src/components/dialogs/settings/index.tsx` (or `SettingsDialogContainer.tsx`)
- Create: `apps/desktop/src/components/dialogs/settings/ConnectionPanel.tsx` (and other panels per simplification doc)
- Modify: `apps/desktop/src/components/SettingsDialog.tsx` (shrink to composition or delete after move)

- [ ] **Step 1: `DialogManager`**

Single component that subscribes to `ui-store` and renders: `DeleteBulkDialog`, `DeleteFolderDialog`, `DeleteNoteDialog`, `RenameFolderDialog`, `RenameIcsDialog`, `AddIcsDialog`, `CreateEventDialog`, `EditEventDialog`, `SettingsDialog`, `CommandBar`, `SearchBar` overlays—whatever is currently sibling-rendered in `App`.

- [ ] **Step 2: Split `SettingsDialog`**

Extract panels: Connection, Auth, Shortcuts, AI config, Calendar—match existing sections in `SettingsDialog.tsx` (names may differ; align to actual file structure).

- [ ] **Step 3: Verify + commit**

Lint/build; manual smoke: open Settings, each tab, create/cancel event dialog; commit `refactor(desktop): add DialogManager and split SettingsDialog`.

---

### Task 5: Decompose `ChatSidebar.tsx`

**Files:**

- Create: `apps/desktop/src/features/chat/ChatView.tsx` (optional layout-only)
- Create: `apps/desktop/src/features/chat/ConversationList.tsx`
- Create: `apps/desktop/src/features/chat/ChatMessages.tsx`
- Create: `apps/desktop/src/features/chat/ChatInput.tsx`
- Create: `apps/desktop/src/features/chat/hooks/use-chat.ts`
- Modify: `apps/desktop/src/components/ChatSidebar.tsx`

- [ ] **Step 1: Extract `use-chat`**

Move streaming send/receive, conversation list loading, and ref handle surface (`ChatSidebarHandle`) into `use-chat.ts`. Export the same imperative API if parent still uses `useImperativeHandle`.

- [ ] **Step 2: Presentational splits**

`ConversationList`, `ChatMessages`, `ChatInput` receive props only; no IPC inside presentational components.

- [ ] **Step 3: `ChatSidebar` as thin composer**

Target &lt;300 lines in `ChatSidebar.tsx`.

- [ ] **Step 4: Verify + commit**

Lint/build; manual: send message, new conversation, stream; commit `refactor(desktop): split ChatSidebar into feature modules`.

---

### Task 6: Decompose `CalendarView.tsx`

**Files:**

- Create: `apps/desktop/src/features/calendar/MonthGrid.tsx`
- Create: `apps/desktop/src/features/calendar/WeekView.tsx`
- Create: `apps/desktop/src/features/calendar/DayView.tsx` (if distinct from week)
- Create: `apps/desktop/src/features/calendar/EventCard.tsx`
- Create: `apps/desktop/src/features/calendar/hooks/use-calendar.ts`
- Modify: `apps/desktop/src/components/CalendarView.tsx`

- [ ] **Step 1: `use-calendar`**

Centralize navigation, visible range, event fetching callbacks, and DnD handlers invoked by the grid.

- [ ] **Step 2: Split views**

Move month/week/day renderers out; keep `CalendarView.tsx` as a switch and shared layout.

- [ ] **Step 3: Verify + commit**

Lint/build; manual: month/week switch, drag event, open event; commit `refactor(desktop): split CalendarView`.

---

### Task 7: Split `lib/api.ts` by domain

**Files:**

- Create: `apps/desktop/src/lib/api/index.ts`
- Create: `apps/desktop/src/lib/api/notes-api.ts`, `calendar-api.ts`, `ai-api.ts`, `auth-api.ts`, `attachments-api.ts`, `settings-api.ts`
- Modify: all `from "./lib/api"` imports (or keep `lib/api.ts` re-exporting from `./api/index` temporarily)

- [ ] **Step 1: Inventory exports**

List every `export` in `apps/desktop/src/lib/api.ts` and assign to a domain file. Shared types go in `packages/shared` only if already shared; otherwise colocate next to the API module.

- [ ] **Step 2: Barrel**

`index.ts` re-exports everything the app previously imported from `./lib/api`.

- [ ] **Step 3: Remove monolith**

Delete body from `lib/api.ts` or replace with `export * from "./api/index"` (single line) until all imports updated.

- [ ] **Step 4: Verify + commit**

Lint/build; commit `refactor(desktop): split IPC api module by domain`.

---

### Task 8: Secondary targets (order flexible)

**Files:**

- Modify: `apps/desktop/src/components/NovelEditor.tsx`
- Modify: `apps/desktop/src/components/NoteTree.tsx`
- Modify: `apps/desktop/src/components/CalendarSidebar.tsx`

- [ ] **Step 1: `NovelEditor`**

Extract slash commands / extensions registration into `novel/extensions.ts` or `features/notes/editor-extensions.ts`.

- [ ] **Step 2: `NoteTree`**

Split DnD hover lock, search filter, and context menu regions into sibling files under `components/note-tree/`.

- [ ] **Step 3: `CalendarSidebar`**

Split subscription list vs actions toolbar.

- [ ] **Step 4: Verify + commit**

Lint/build; commit per component or one combined `refactor(desktop): trim NovelEditor, NoteTree, CalendarSidebar`.

---

## Self-review

| Spec item (simplification Proposal 4)    | Task |
| ---------------------------------------- | ---- |
| App.tsx → shell + Zustand                | 1–3  |
| ChatSidebar decomposition                | 5    |
| CalendarView decomposition               | 6    |
| api.ts split                             | 7    |
| SettingsDialog + DialogManager           | 4    |
| NovelEditor / NoteTree / CalendarSidebar | 8    |

**Placeholder scan:** No TBD/TODO left in task descriptions.

**Type consistency:** `SidebarMode`, `CalendarViewType`, `ConnectionStatus` must be imported from a single canonical module after moves (prefer `types.ts` or component `type` re-exports).

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-proposal-4-component-decomposition.md`. Two execution options:**

1. **Subagent-driven (recommended)** — Dispatch a fresh subagent per task; review between tasks. **Required sub-skill:** superpowers:subagent-driven-development.

2. **Inline execution** — Run tasks in this session with checkpoints. **Required sub-skill:** superpowers:executing-plans.

**Which approach do you want?**
