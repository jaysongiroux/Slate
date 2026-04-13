# Dialog Glass Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle desktop dialogs to use a darker frosted-glass surface and cinematic overlay inspired by the calendar popover treatment.

**Architecture:** Keep the Radix dialog structure unchanged and apply the visual treatment through the shared dialog component and global stylesheet. Reuse existing theme language from the calendar popovers while introducing dialog-specific gradients, border highlights, blur, and shadow depth.

**Tech Stack:** React, Radix Dialog, Tailwind utility classes, shared CSS in `tailwind.css`

---

### Task 1: Apply The Dialog Styling Pass

**Files:**

- Modify: `apps/desktop/src/components/ui/dialog.tsx`
- Modify: `apps/desktop/src/styles/tailwind.css`

- [ ] **Step 1: Confirm the styling scope**

Review the current dialog markup and the glassy calendar popover styles to keep sizing and behavior intact while changing only presentation.

- [ ] **Step 2: Add the dialog glass tokens and overlay treatment**

Define dialog-specific CSS variables and reusable visual layers in `apps/desktop/src/styles/tailwind.css` for:

- the dark cinematic overlay
- the deep-frost panel gradient
- the border/highlight treatment
- the heavier blur and shadow stack

- [ ] **Step 3: Update the shared dialog component classes**

Adjust `apps/desktop/src/components/ui/dialog.tsx` so the overlay and content opt into the new shared styles without changing consumer APIs.

- [ ] **Step 4: Verify the edited files**

Run a targeted TypeScript-aware check or project test command that exercises the edited desktop app codepath, then review the output before reporting status.
