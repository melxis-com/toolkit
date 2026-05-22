---
name: melxis-task
description: Proactively tracks cross-session work plans — multi-step tasks, status, and handoffs between sessions and agents — as tasks in hives (namespaces). Default write policy is auto — agent saves directly when intent is clear. The toolkit env var MELXIS_WRITE_POLICY (auto / smart / confirm; default auto) overrides. Do NOT use for declarative knowledge (use melxis-memory), single-session todos, or purely local note files.
when_to_use: Use when the user plans multi-step work ("let's split into steps", "タスクに分ける", "手順を作る"), asks what remains ("what's left", "残っているタスク", "pending work"), marks progress ("done with X", "Xできた", "completed"), hands off unfinished work at session end, or resumes prior multi-step work at session start. Flow — recall (task_search → task_get for detail), create (task_create with related_mel_ids to link design context), progress (task_update for status changes). Write behavior follows the active MELXIS_WRITE_POLICY block injected by the SessionStart hook.
---

# Melxis Task

## Core Concepts

- **Hive**: A namespace for grouping related mels and tasks (e.g., per project, per topic).
- **Task**: A unit of shared intent — an agent's work plan that persists across sessions. Tasks enable coordination between agents and humans. Unlike mels (declarative knowledge), tasks are imperative (what to do).

> For saving decisions, learnings, and building a knowledge graph, see the **melxis-memory** skill.
> Use `related_mel_ids` when creating tasks to connect them to relevant knowledge.

## Quick Reference

| Action | Tool | When to Use |
|--------|------|-------------|
| Find hives | `hive_search` | Locate the right namespace before reading or writing |
| Search tasks | `task_search` | Find tasks by keyword, status, tags, or owner |
| Get task | `task_get` | Retrieve full detail of a task (description, resolved `related_tasks` / `related_mels`, sub_tasks) |
| Create task | `task_create` | Plan multi-step work across sessions |
| Patch task | `task_patch` | Localized edits to task descriptions / handoff snapshots |
| Update task | `task_update` | Update status, priority, links, or full task details |
| Delete task | `task_delete` | Remove completed or cancelled tasks |

---

## When to Use Tasks

Create or update tasks when:

- The user requests **multi-step work** — create tasks to plan and track progress
- A **session is ending with unfinished work** — create tasks to hand off to the next session
- The user explicitly asks to **plan**, **track**, or **create tasks**
- The user asks **what tasks remain** or checks task status
- A task is **progressing or completed** — update status (`in_progress` → `completed`)

If Melxis MCP tools are unavailable, or a Melxis MCP call fails because of authentication, token, or connection errors, tell the user explicitly. Do not silently continue as if tasks were checked or updated. Ask the user to reconnect or sign in to Melxis MCP, then retry the Melxis call after they confirm. On Codex CLI, suggest `codex mcp login melxis`.

Routine Melxis bookkeeping stays silent; see AGENTS.md §Routine Melxis Bookkeeping. MCP availability, authentication, token, and connection failures are not routine and must still be reported.

---

## Resume / Checkpoint Recovery

When resuming work or recovering after a missed checkpoint, do more than find the task. If progress is not reflected in Melxis, call `task_patch` or `task_update` before substantive work:

- Refresh the parent task `description` as compressed current state, not append-only history. Prefer `task_patch` for localized section replacement; if it fails due to stale text, call `task_get` and fall back to `task_update(description=...)` with a freshly compressed state.
- Update `status`, `priority`, `tags`, and `related_mel_ids` when the current state changed.
- Keep the parent task as goal / why / Definition of Done.
- Create or update sub-tasks for independently resumable remaining work with separate completion criteria.
- Do not create sub-tasks for ephemeral same-turn steps.

Routine updates stay silent unless they affect the user-facing answer or require a real user decision.

---

## Search Tasks

```
task_search(hive_id: "<hive-id>")
task_search(hive_id: "<hive-id>", status: "in_progress")
task_search(hive_id: "<hive-id>", query: "auth migration")
task_search(hive_id: "<hive-id>", parent_task_id: "root")
task_search(hive_id: "<hive-id>", ids: ["<id1>", "<id2>", ...])  # batch hydrate
```

`ids` resolves a known list (e.g. `related_task_ids`) in one round-trip — up to 50 IDs per call. Use `task_get` only when you need the full description of a single task.

Supports filtering by:
- `query` — keyword match on title
- `status` — `pending`, `in_progress`, `completed`, `cancelled`
- `tags` — AND match on tag list
- `owner` — filter by assignee
- `parent_task_id` — use `"root"` for top-level tasks only, or a task ID for sub-tasks

Without a query or filters, returns all tasks ordered by priority then updated_at.

### Response format

- `task_search` → `[{id, hive_id, parent_task_id, title, status, priority, owner, tags, related_mel_ids, related_task_ids, updated_at}]`

---

## Get Task Detail

```
task_get(id: "<task-id>")
```

Returns the full task including description, resolved `related_tasks` (each `{id, title, status, priority}`), resolved `related_mels` (each `{id, name}`), and — for root tasks — a `sub_tasks` array. Raw `related_*_ids` are not exposed by `task_get` — the resolved arrays preserve the caller's input order, and archived / cross-hive / deleted references are silently dropped (max 50 each). Use this when you need more than the search summary: to read description, inspect 1-hop relationships, or list sub-tasks under a parent. For full link metadata (direction / reason / confidence) on a specific mel, call `mel_get` on its id.

Note: `task_search` still returns raw `related_mel_ids` / `related_task_ids` on each row — only `task_get` resolves them.

---

## Create & Manage Tasks

### Create a task

```
task_create(
  hive_id: "<hive-id>",
  title: "Migrate auth to JWT",
  description: "## Steps\n\n1. ...\n2. ...",
  priority: "high",
  tags: ["auth", "migration"],
  related_mel_ids: ["<mel-id>"]
)
```

- Tasks support **2-level hierarchy**: root tasks and sub-tasks (via `parent_task_id`).
- Use `related_mel_ids` to connect tasks to relevant design decisions or learnings from **melxis-memory**.
- Use `related_task_ids` to connect related tasks.

### Update a task

```
task_patch(id: "<task-id>", old_text: "Current: ...", new_text: "Current: ...")
task_update(id: "<task-id>", status: "in_progress")
task_update(id: "<task-id>", status: "completed")
task_update(id: "<task-id>", priority: "urgent", tags: ["blocker"])
```

Use `task_patch` for localized `description` edits, especially handoff snapshot / current-state sections. It is content-addressed like `mel_patch`: if `old_text` is missing or matches multiple places, the tool fails rather than appending ambiguous text. On failure, call `task_get`, rebuild the intended section from the latest description, and use `task_update(description=...)`.

Status flow: `pending` → `in_progress` → `completed` / `cancelled`.

### Updating Array Fields (read-modify-write)

Array fields — `tags`, `related_mel_ids`, `related_task_ids` — are **fully replaced** by `task_update`, not appended. To add or remove items, read the existing value first. Note: `task_get` returns *resolved* `related_mels` / `related_tasks` (not raw IDs), so map back to ids before calling `task_update` (which still takes raw id arrays):

```
existing = task_get(id: "<task-id>")
existing_mel_ids = existing.related_mels.map(m => m.id)
merged = [...existing_mel_ids, "<new-mel-id>"]
task_update(id: "<task-id>", related_mel_ids: merged)
```

Filtering out items follows the same pattern. Do not call `task_update` with a partial array expecting a merge.

### Delete a task

```
task_delete(id: "<task-id>")
```

Follows the active `MELXIS_WRITE_POLICY` (auto / smart / confirm) — same as create/update. Note: deletion is currently hard delete, so apply judgement (e.g., for `cancelled` work consider archive over delete; see Operational conventions). Graphiti-aligned soft / bi-temporal invalidation is planned mid-term work.

---

## Connecting Tasks and Knowledge

Tasks and mels serve different purposes but work together:

| | Mel (melxis-memory) | Task (melxis-task) |
|--|---------------------|-------------------|
| Nature | Declarative — what is known | Imperative — what to do |
| Lifecycle | Persists and grows | Created → completed → removed |
| Example | "We chose JWT because..." | "Migrate auth to JWT" |

Use `related_mel_ids` when creating tasks to link them to the decisions and context behind the work. This makes it easy for the next agent or session to understand *why* the task exists.

---

## Best Practices

A task is shared intent — externalized reasoning state that the next agent or session can pick up. Apply these practices so the trace stays meaningful across handoffs.

- **Status reflects commitment, not activity** (BDI-style intent tracking): `pending` = planned but not yet committed to act on; `in_progress` = actively being worked on right now; `completed` = the definition-of-done is met; `cancelled` = explicitly abandoned with a reason recorded in the description. Avoid silently leaving tasks in `in_progress` when work has stopped — either move them back to `pending`, mark `cancelled` with a reason, or finish to `completed`. To reopen a `completed` task, create a new task that links back to the old one rather than flipping the status.
- **Keep task granularity to one independently resumable intention** (GTD/PARA + BDI discipline): a task should have one coherent definition of done that the next agent can resume from `description` + `related_mel_ids`. Split when a task contains multiple independent outcomes, different priorities, different owners/surfaces, or separate completion criteria. Do not split merely because the title mentions multiple files, products, or surfaces if the DoD is one coherent outcome (e.g. "LP / Web / MCP guide consistency check").
- **Split implementation from verification when verification outlives coding**: if dogfood, real-client behavior, release readiness, external environment checks, or user-reported observations remain after code/tests pass, close the implementation task and create a separate verification task with `related_task_ids` pointing to the implementation task. When useful, read-modify-write the implementation task's `related_task_ids` back to the verification task; do not rely on description-only references. Do not split routine unit tests, lint, or same-session checks into separate tasks.
- **Title carries the why, description carries the how and the thinking** (reason-and-act framing): make the root task title express the goal or motivation, and sub-task titles express the concrete step. Use `description` to record the definition of done plus the trace of thinking — alternatives considered, blockers encountered, evidence gathered, and concrete checks still needed. The next agent should be able to resume from `description` alone.
- **Parent task descriptions are compressed current state, not logs** (GTD/PARA + ReAct discipline): do not append every turn or completed step. Keep parent descriptions focused on Goal, Current state, Scope/constraints, Evidence status, and links. When old notes stop helping the next agent act, replace them with a shorter summary via `task_patch`; use `task_update(description=...)` when the whole description needs rewriting.
- **Use sub-tasks for independently resumable next actions**: if a next action can be picked up in a later session, has its own completion condition, or can be owned/reviewed separately, create it as a sub-task instead of adding another bullet to the parent description. Do not create sub-tasks for ephemeral single-session steps such as "open file", "run test", or "inspect diff".
- **Preserve evidence status in the task trace** (provenance discipline): task descriptions should separate facts, user reports, and next actions. Avoid carrying hypotheses unless they are needed to define a concrete verification step. If a claim is based only on user report (dogfood behavior, trigger rates, client differences), mark it as user-reported / needs-verification in the description and add `user-reported` / `needs-verification` tags when useful. Promote it with `task_update` after logs, transcripts, code, docs, or other evidence confirms it. User preferences and explicit decisions can be recorded directly, but split out any external factual claim that still needs verification.
- **Priority is engagement, not importance** (GTD-style "engage" layer): priority signals when you intend to act. `urgent` / `high` / `normal` mean it belongs on the active radar; `low` is a Someday/Maybe parking lot for ideas you may revisit but are not committing to now.
- **At task start, recover context before acting** (reason-and-act framing): when `task_update` sets status to `in_progress`, run `mel_search` on the task topic and **batch-hydrate the related mels in one call** instead of calling `mel_get` per id. If you loaded the task via `task_get` use `mel_search(ids: related_mels.map(m => m.id))`; if via `task_search` use `mel_search(ids: related_mel_ids)` directly. Use `mel_get` only for the specific mels whose full content (not just summary) you need. Resume from the loaded rationale, not a cold reading of `description`. The point of the related-mel link is exactly this hand-off.
- **At closure, evaluate feedback into memory** (reflective + skill-library framing — most important): when a task moves to `completed` or `cancelled`, review the conversation log, task trace, tool activity, and related mels. Do not assume this means "always create a mel".
  - **Existing memory refinement** — if the lesson corrects, narrows, or sharpens an existing mel, prefer `mel_patch` or `mel_update`.
  - **Insight (WHY)** — search existing mels first. If the lesson is genuinely new, save a design decision, root cause, or anti-pattern with `mel_create` and tag `design-decision` / `bug-fix` / `anti-pattern`.
  - **Procedure (HOW)** — search existing convention/procedure mels first. If the work established a genuinely new reusable recipe worth applying to similar future tasks, save it with `mel_create` and tag `convention`.
  - **Granularity** — whether the completed/cancelled task actually contained multiple independently resumable intentions, different owners/surfaces, or separate completion criteria. Capture the split pattern as a reusable procedure or anti-pattern when it would improve future planning.
  Link task-derived memory back to the source task with reason `"extracted-from-task"` when useful. Skip when nothing is durable across sessions. See **melxis-memory** for the saving flow.
- **Link the context that justifies the work** (map-of-content discipline): when creating or updating a task, set `related_mel_ids` to the ADRs, root-cause analyses, or design mels that explain why the work exists. This is strongly recommended — without it the next agent cannot reconstruct the rationale.
- **Propose bidirectional links** (graph density discipline): whenever `task_create` / `task_update` adds `related_mel_ids`, also propose `mel_link_create` between those mels (reason: `part-of`) so the design context is dense in the mel graph, not only in the task. Symmetrically, when closure feedback updates or creates relevant memory, propose adding the relevant mel ID to the active task's `related_mel_ids` (read-modify-write — arrays are replaced, not appended).
- **Search before creating**: Use `task_search` to check for existing tasks and avoid duplicates.
- **Use hierarchy**: Group related sub-tasks under a root task for organization.
- **Write behavior follows `MELXIS_WRITE_POLICY`** (default `auto` — agent calls write tools directly when intent is clear). The SessionStart hook injects the active policy block; consult it for the authoritative behavior. Deletion follows the same policy (no carve-out).

---

## Operational conventions (dogfooding)

> The conventions below are the **melxis-com internal practice** used while building Melxis itself. They are documented here as a concrete example — adapt the thresholds and tag vocabulary for your own team rather than treating them as normative.

- **What counts as `urgent`**: reserved for launch blockers and production incidents only. Day-to-day "soon" work belongs in `high`. This keeps `urgent` meaningful as a signal that something is actively breaking the business.
- **WIP guideline for `urgent` root tasks**: keep the number of `urgent` root tasks in flight low — roughly three at a time. When the count grows beyond that, the signal is no longer about scarcity and engagement degrades.
- **Tag vocabulary — two axes, kept minimal**:
  - *Domain axis* (existing): `lp`, `legal`, `agent`, `web`, `db`, and similar area tags that mark which surface a task touches. Maintain the established vocabulary; do not invent parallel synonyms.
  - *Type axis* (added minimally): `release`, `bug-fix`, `feature`. Add new type tags only when an existing one clearly does not fit.
- **Archive vs delete**: prefer soft-delete (archive) over hard delete for completed or cancelled tasks. Status (`completed` / `cancelled`) and archive state are orthogonal — a task can be `completed` and still live, or `cancelled` and archived. Hard `task_delete` is reserved for genuine mistakes (duplicates, accidental creation), not for routine cleanup of finished work.

---

## Errors

| Error | Cause | Action |
|-------|-------|--------|
| `Authentication required` | Not authenticated | Guide user through OAuth flow |
| `No write access to hive` | Viewer role on this hive | Check role with `hive_search` |
| `Item limit reached` | Account task quota exceeded | Inform user of plan limits |
