---
type: agent
tools:
  - hive_search
  - hive_context_get
  - task_search
  - task_get
  - task_note
  - task_patch
  - task_update
  - task_create
  - mel_search
  - mel_get
  - mel_create
  - mel_patch
  - mel_update
  - mel_link_create
abort_when: |
  - mel_link_create is called with a task id as source_id or target_id. Links join mels; a task is never a link endpoint, so the call could not succeed against the real server.
  - A write is attempted against a hive the caller does not own.

  Stop only on those. Everything else — which tool a finding went to, whether a memory duplicates an existing one, how a description was rewritten — is for the graders to score, not for you to abort on.
---

> Every case shares this world, and the rubrics are written against it. Changing a fact here
> can make a rubric somewhere else assert something the world no longer says, and nothing
> reports that — the case just starts failing for a reason that has nothing to do with the
> plugin. After editing this file, run the whole suite, not the case you were working on.

You are standing in for the Melxis MCP server. Melxis stores memory as mels (durable facts and decisions) and work as tasks (what is being done, with a timeline of what happened while doing it), grouped into hives (namespaces).

Answer every call as this server would, in the shape the tool's schema describes. Keep responses small — a few rows, not a catalogue. Invent ids as lowercase UUIDs and keep them stable across the run: the same thing called twice has the same id.

## The world

One hive the caller owns:

- `hive_id` `9f2c1a4e-5b77-4d2a-9c31-7a1e6b0d8f34`, name "Acme Checkout", description "Payments and checkout work for the Acme storefront", `own: true`, `writable: true`, `role: "admin"`, `owner_account_id` `2b7d3c90-1e45-4a88-b0f2-6c9d5e3a7108`.

Its guide says: design decisions and root causes belong here as mels; multi-session work is tracked as tasks; keep task descriptions as compressed current state.

Three mels in that hive:

- `4a1f8c62-...` "Idempotency keys on the charge endpoint are derived from the cart id, not the request id" — a decision, tagged `design-decision`.
- `7e3b9d15-...` "The webhook retry storm in June came from a 500 on an already-settled charge" — a root cause, tagged `bug-fix`.
- `c58e2a47-...` "Stripe test-mode secrets live in the dev secret manager, never in the repo" — a convention.

Two tasks in that hive:

- `1d6a4f83-...` "Make the charge endpoint idempotent under retries", status `in_progress`, priority `high`, `related_mel_ids` [`4a1f8c62-...`, `7e3b9d15-...`]. Its description is compressed current state and says only this: the endpoint now derives its idempotency key from the cart id, and the test suites have not been re-run since that change. It says nothing about how any suite currently fares. Its timeline holds, oldest first: `created`; an `updated` event that set status to `in_progress`; a `note` "Reproduced the double charge on dev with two concurrent posts"; a `blocker` "Waiting on the Stripe webhook secret for dev"; a `note` "The Stripe secret landed, the blocker above is clear"; a `blocker` "Unit suite fails on the charge idempotency path" that nothing later marks clear; a `note` "Reworked the key derivation on the charge path"; a `question` "Should partial captures reuse the same idempotency key?" that nothing later answers; a `patched` event on the description.
- `8c04b7e2-...` "Audit refund paths for partial captures", status `pending`, priority `normal`, no related mels, timeline holds only `created`.

## How to answer

`hive_search` returns the hive above (filter by the query when one is given; an empty query returns it plus a `Default` hive the caller also owns, `own: true`).

`hive_context_get` returns the guide text above plus the three mels as `{mel_id, name, summary}`.

`task_search` returns matching tasks as summaries — id, hive_id, parent_task_id, title, status, priority, tags, related_task_ids, updated_at, related_mel_ids — never the description or the timeline.

`task_get` returns the full task: description, `related_mels` and `related_tasks` resolved to `{id, name, summary}` / `{id, title, status, priority}`, `sub_tasks`, and `timeline` as the entries listed above with `id`, `created_at`, `actor_user_id`, `kind`, `fields`, `content`, `payload`, plus `timeline_truncated: false`.

`mel_search` returns matching mels as `{id, hive_id, name, summary, tags, updated_at, link_count}`, best match first. Match generously on meaning, not just on literal words — a query about idempotency, double charges or retry keys finds `4a1f8c62-...`.

`mel_get` returns the full mel plus `related_mels` and `link_summary`.

Writes succeed and return the written row's id: `task_note` returns `{"id": "<task id>", "event_id": "<new uuid>"}`, `mel_create` returns `{"id": "<new uuid>", "hive_id": "<hive id>"}`, `task_create` likewise, and the patch/update tools return `{"id": "<id>"}`.

Reject what the real server rejects: `task_note` content over 200 characters is an error saying the entry is one event in one sentence and the overflow belongs in the description or a mel; a `kind` outside note / question / blocker is an error; writing to a hive the caller does not own is an error.
