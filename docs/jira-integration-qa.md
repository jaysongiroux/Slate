# Jira Integration — Requirements Q&A

**Date:** 2026-04-16

---

## Q1: Primary goal of integrating Jira into Slate?

**Answer:** Two goals:

- **View and manage Jira issues** alongside other work (notes, calendar, links) — a unified dashboard
- **Create/update Jira issues** from within Slate without switching to the browser

---

## Q2: Jira deployment type?

**Answer:** Support both Jira Cloud (`*.atlassian.net`) and Jira Server/Data Center (self-hosted).

---

## Q3: Authentication method?

**Answer:** API token — user provides a base URL, API token, and email. Simple, works for both Cloud and Server. Matches the existing Linkwarden pattern.

---

## Q4: What Jira data to display?

**Answer:** All of the following:

- Issues assigned to me (my work queue)
- Issues I'm watching
- Browse by project — all issues in a project
- Sprint/board view — issues grouped by sprint or kanban columns
- Custom JQL queries (power-user filters)
- Issue details — full details (description, comments, attachments, subtasks) inline

---

## Q5: Create/update actions needed?

**Answer:** All except time tracking:

- Create new issues (project, issue type, summary, description, assignee, priority)
- Transition issues (workflow states — To Do, In Progress, Done, etc.)
- Add comments to issues
- Edit issue fields (summary, description, assignee, priority, labels, etc.)

---

## Q6: Multiple instances?

**Answer:** Yes — support connecting to multiple Jira instances simultaneously (e.g. work Cloud + personal Server). Same pattern as Linkwarden.

---

## Q7: Sidebar navigation structure?

**Answer:** Instance > Project > Board/Sprint drill-down hierarchy, plus saved JQL queries as bookmarks in the sidebar.

---

## Q8: Issue detail view — editing model?

**Answer:** Full inline editing — click on fields to edit them directly in the detail view. No modals for field edits.

---

## Q9: Cross-feature integration?

**Answer:** Standalone panel only for v1 — no links to notes, calendar, or Linkwarden. Command bar integration for quick jumping to the Jira extension.

---

## Q10: Sprint/board view fidelity?

**Answer:** Full drag-and-drop board — move issues between columns by dragging, which triggers status transitions.

---

## Q11: Saved JQL queries?

**Answer:** Local only — users create and manage saved queries within Slate. No import/sync from Jira's saved filters.

---

## Q12: Feature priority order (incremental delivery)?

**Answer:** Ship incrementally in this order, verifying each section before moving on:

1. Connect instances + browse projects/issues
2. Issue detail view with inline editing
3. Create new issues
4. Status transitions + comments
5. Sprint/board view with drag-and-drop
6. Assigned to Me / Watching quick filters
7. Saved JQL queries
8. Command bar integration

---

## Key Architectural Decisions (from context)

- Follows the existing Linkwarden integration pattern (shared types, backend service, IPC bridge, frontend API, Zustand store, panel/sidebar components)
- API tokens stored encrypted in the settings table (server-side only)
- All operations scoped to userId (multi-tenant)
- Feature toggle via settings key (`extensions.jiraEnabled`)
- Backend proxies all Jira API calls — frontend never talks to Jira directly
