# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current repository README with a product-first document that converts new visitors and explains the architecture at a high level, while moving contributor-heavy setup into a separate doc.

**Architecture:** Keep the top-level README focused on product value, screenshots, and a concise system diagram. Store repo-controlled visual assets in `docs/assets/` as lightweight SVG mockups derived from the provided screenshots. Move setup and contributor workflow detail into a dedicated development doc linked from the README.

**Tech Stack:** Markdown, GitHub-flavored HTML, Mermaid, SVG assets

---

### Task 1: Gather README Inputs

**Files:**
- Modify: `README.md`
- Reference: `package.json`
- Reference: `apps/desktop/package.json`
- Reference: `apps/core-backend/package.json`
- Reference: `apps/admin-backend/package.json`

- [ ] Review current README content and preserve accurate setup, architecture, and repo structure details.
- [ ] Review workspace package metadata for product and architecture claims that the README can make safely.
- [ ] Identify which contributor-heavy sections should move out of the README into a separate doc.

### Task 2: Create Visual Assets

**Files:**
- Create: `docs/assets/readme-hero.svg`
- Create: `docs/assets/readme-notes-view.svg`
- Create: `docs/assets/readme-ai-chat.svg`
- Create: `docs/assets/readme-settings.svg`

- [ ] Create a hero-style asset that evokes the Slate desktop interface.
- [ ] Create screenshot-style SVG illustrations based on the attached UI references.
- [ ] Keep filenames stable and README-friendly so links are durable.

### Task 3: Rewrite the README

**Files:**
- Modify: `README.md`

- [ ] Replace the current utilitarian README with a product-first structure.
- [ ] Add concise sections for product promise, feature highlights, image gallery, architecture, and minimal getting-started steps.
- [ ] Link to the separate development doc instead of embedding contributor-heavy setup detail inline.

### Task 4: Split Contributor Docs

**Files:**
- Create: `docs/development.md`

- [ ] Move the detailed local development, Docker workflow, and OIDC quick reference into a dedicated doc.
- [ ] Preserve commands already used by the repo so the split is editorial, not behavioral.
- [ ] Ensure the README links directly to the new doc.

### Task 5: Verify Rendering

**Files:**
- Verify: `README.md`
- Verify: `docs/development.md`
- Verify: `docs/assets/*.svg`

- [ ] Check Markdown image paths and internal links.
- [ ] Check Mermaid formatting and basic readability of the README structure.
- [ ] Confirm the new assets live under `docs/assets/` and the docs split leaves no broken references.
