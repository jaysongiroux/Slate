# Insert Template Slash Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore "Insert from template" in the editor slash menu so a selected template appends its content to the current note.

**Architecture:** Keep the slash menu itself simple with one static "Insert from template" action that opens a renderer-side picker. Load the selected template's local Yjs document from IndexedDB, extract insertable ProseMirror content, and append that content into the current Novel editor.

**Tech Stack:** React 19, Novel/Tiptap, Yjs, y-indexeddb, y-prosemirror, Vitest, Node test runner

---

### Task 1: Add template content loader utilities

**Files:**

- Create: `apps/desktop/src/lib/template-content.ts`
- Create: `apps/desktop/src/lib/template-content.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test --workspace @slate/desktop -- template-content.test.ts` to verify it fails**
- [ ] **Step 3: Implement the minimal Yjs/IndexedDB template loader and content extraction helpers**
- [ ] **Step 4: Run `npm run test --workspace @slate/desktop -- template-content.test.ts` to verify it passes**

### Task 2: Add the template picker UI and slash command wiring

**Files:**

- Create: `apps/desktop/src/components/TemplateInsertPicker.tsx`
- Modify: `apps/desktop/src/components/NovelEditor.tsx`
- Modify: `apps/desktop/src/lib/api.ts`
- Test: `apps/desktop/electron/services/paste-markdown.test.mjs`

- [ ] **Step 1: Write/extend failing tests for the slash-menu wiring**
- [ ] **Step 2: Run the targeted desktop tests to verify they fail for the missing command/picker integration**
- [ ] **Step 3: Implement the picker state, template listing, and append-on-select behavior**
- [ ] **Step 4: Run the targeted desktop tests to verify they pass**

### Task 3: Verify the restored workflow

**Files:**

- Verify only

- [ ] **Step 1: Run `npm run test --workspace @slate/shared`**
- [ ] **Step 2: Run `npm run test --workspace @slate/desktop` and note any unrelated existing failures**
- [ ] **Step 3: Run `npm run build --workspace @slate/shared`**
- [ ] **Step 4: Run `npm run build --workspace @slate/desktop` and note any unrelated existing failures**
