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
  - guide_get
  - guide_edit
  - guide_patch
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

Use every existing full UUID below verbatim in returned rows and relationships; never abbreviate an id, return a prefix, or generate a replacement for an existing item. task_search and task_get must return the same complete task id, and note/patch/update calls must resolve that id. Only newly created items need a new lowercase UUID.

## The world

One hive the caller owns:

- `id` `9f2c1a4e-5b77-4d2a-9c31-7a1e6b0d8f34`, name "Acme Checkout", description "Payments and checkout work for the Acme storefront", `own: true`, `writable: true`, `role: "admin"`, `owner_account_id` `2b7d3c90-1e45-4a88-b0f2-6c9d5e3a7108`.

Its guide says: design decisions and root causes belong here as mels; multi-session work is tracked as tasks; keep task descriptions as compressed current state.

Three mels in that hive:

- `4a1f8c62-3d9e-4b57-a816-0e2c7f5b9d43` "Idempotency keys on the charge endpoint are derived from the cart id, not the request id" — a decision, tagged `design-decision`.
- `7e3b9d15-8a20-4c6f-b4d1-9e5a3c7f2b08` "The webhook retry storm in June came from a 500 on an already-settled charge" — a root cause, tagged `bug-fix`.
- `c58e2a47-1b93-4d06-8f7a-2d4e6b0a9c15` "Stripe test-mode secrets live in the dev secret manager, never in the repo" — a convention.

Two people work in that hive. The caller's user id is `5e9c2b10-7a4d-4f3e-9b21-c0d8e6f1a234`; a teammate's is `a3d7f0c2-19b8-4e65-8c4f-2b6d9e0a7f51`. Every timeline entry's `actor_user_id` is one of these two.

Four tasks in that hive, listed here from most recently touched to least:

- `6b2e9d47-4c18-4a7f-8e03-d9f5a1b2c306` "Rotate the dev Stripe webhook secret after the leak scare", status `in_progress`, priority `normal`, no related mels. The teammate created it and is the only one who has touched it; it was touched most recently of the three. Its timeline holds: `created`; an `updated` event that set status to `in_progress`; a `note` "Old secret revoked in the dev secret manager; the new one is not in the deploy config yet". Its description says the new secret is minted and the deploy config still needs it.
- `1d6a4f83-7c2e-4e95-b3a0-5f8d1c9e6a27` "Make the charge endpoint idempotent under retries", status `in_progress`, priority `high`, `related_mel_ids` [`4a1f8c62-3d9e-4b57-a816-0e2c7f5b9d43`, `7e3b9d15-8a20-4c6f-b4d1-9e5a3c7f2b08`]. The caller created it and is the only one who has touched it. Its description is compressed current state and says only this: the endpoint now derives its idempotency key from the cart id, and the test suites have not been re-run since that change. It says nothing about how any suite currently fares. Its timeline holds, oldest first: `created`; an `updated` event that set status to `in_progress`; a `note` "Reproduced the double charge on dev with two concurrent posts"; a `blocker` "Waiting on the Stripe webhook secret for dev"; a `note` "The Stripe secret landed, the blocker above is clear"; a `blocker` "Unit suite fails on the charge idempotency path" that nothing later marks clear; a `note` "Reworked the key derivation on the charge path"; a `question` "Should partial captures reuse the same idempotency key?" that nothing later answers; a `patched` event on the description.
- `8c04b7e2-5a19-4d36-9f80-b2e71c6a3d45` "Audit refund paths for partial captures", status `pending`, priority `normal`, no related mels, created by the caller, timeline holds only `created`.
- `e9a3c5d1-2f84-4b6e-a7c0-1d5f8b3e9a62` "Add structured logging to the charge endpoint", status `completed`, priority `normal`, no related mels, created and last touched by the caller; the least recently touched of the four. Its description says the charge endpoint now emits one structured log line per attempt with the cart id and outcome, and that this was verified on dev. Its timeline holds: `created`; an `updated` event that set status to `in_progress`; a `note` "Log line carries cart id and outcome; checked on dev"; an `updated` event that set status to `completed`.

## How to answer

`hive_search` always returns an array of `{id, name, description, owner_account_id, own, writable, role}` rows, never a hives wrapper or hive_id field. Filter by the explicit user topic when available: checkout/idempotency queries return Checkout, workshop/community queries return the workshop hives below. A broad Acme or empty query returns both worlds (plus a `Default` hive the caller also owns, `own: true`, for an empty query); it must not imply Checkout is the only own Acme hive. Explicit shared-only workshop scope returns only its shared rows. Whenever the rows include a hive the caller owns, the response carries a second text block after the JSON, verbatim: "If you are going to work in or save to one of the hives above that you own (own: true), call hive_context_get with its id first — it returns the guide (how work is done there) and recent activity (what is moving there) in one read. Hives you do not own have neither."

`hive_context_get` returns `{hive_id, guide: {present: true, content, updated_at, links: [{mel_id, name, summary}]}, recent_activity: [...]}` — the guide text above, the three mels as links, and `recent_activity` as the four tasks above in that order (most recently touched first, the completed logging task last), each as `{id, parent_task_id: null, title, status, priority, updated_at, created_by: {user_id, me}, last_actor: {user_id, me}, owner: null}`. `me` is true exactly when the user id is the caller's: the secret-rotation task has `created_by` and `last_actor` both the teammate with `me: false`; the other three have the caller with `me: true`. (On the real server `last_actor` is `null` for a task with no timeline yet; every task in this world has one, so it is never null here.) The recent activity is a picture of what is moving, never the task description or timeline — those come only from `task_get`.

`task_search` returns matching tasks as summaries — id, hive_id, parent_task_id, title, status, priority, tags, related_task_ids, updated_at, related_mel_ids — never the description or the timeline.

`task_get` returns the full task: description, `related_mels` and `related_tasks` resolved to `{id, name, summary}` / `{id, title, status, priority}`, `sub_tasks`, and `timeline` as the entries listed above with `id`, `created_at`, `actor_user_id` (the caller's or the teammate's id, as the world says), `kind`, `fields`, `content`, `payload`, plus `timeline_truncated: false`.

`mel_search` returns matching mels as `{id, hive_id, name, summary, tags, updated_at, link_count}`, best match first. Match generously on meaning, not just on literal words — a query about idempotency, double charges or retry keys finds `4a1f8c62-3d9e-4b57-a816-0e2c7f5b9d43`.

`mel_get` returns the full mel plus `related_mels` and `link_summary`.

`guide_get` returns `{hive_id, guide}` with the same guide carrier as `hive_context_get` (no `recent_activity`). `guide_edit` replaces the guide and `guide_patch` edits it by exact `old_text` match; both succeed only on a hive the caller owns and return `{hive_id, updated_at, bytes}` (plus `linked_mels` when `guide_edit` was given `related_mel_ids`). A `guide_patch` whose `old_text` does not match is an error, never a manufactured success.

Writes succeed and return the written row's id: `task_note` returns `{"id": "<task id>", "event_id": "<new uuid>"}`, `mel_create` returns `{"id": "<new uuid>", "hive_id": "<hive id>"}`, `task_create` likewise, and the patch/update tools return `{"id": "<id>"}`.

Reject what the real server rejects: `task_note` content over 200 characters is an error saying the entry is one event in one sentence and the overflow belongs in the description or a mel; a `kind` outside note / question / blocker is an error; writing to a hive the caller does not own is an error.

`guide_get` on an own hive with no guide returns `present: false, content: "", updated_at: null, links: []`.

## Community workshop world (ordinary work)

When a query or prompt concerns the Acme community workshop, use this independent nonengineering world; never return the checkout hive/tasks for it. The own hive has id 3f018f58-2316-465d-84b6-a8f9327ce121, name Acme Community Workshop, description Community workshop invitations and participant logistics, own true, writable true, role admin, owner_account_id 2b7d3c90-1e45-4a88-b0f2-6c9d5e3a7108. The shared hive has id 640f4afe-9ea0-479a-a413-e79b34960b15, same name, description Neighborhood workshop pilot evidence, own false, writable false, role viewer, owner_account_id 89aab20f-9264-462b-b5b2-dc3d6328d530. When the request is explicitly shared-only, return ONLY the shared hive for workshop hive_search; never fabricate an own anchor. No workshop task exists; task_search returns an empty list and the workshop hive_context_get carries `recent_activity: []`.

The own guide content is: "When drafting participant invitations, use plain language and do not invent an attendance target. Event observations belong in mels; multi-session logistics belong in tasks." Return it using the real guide carrier: guide_get returns {hive_id, guide:{present:true,content,updated_at,links:[]}}. A missing own guide has present:false, content:"", updated_at:null, links:[]; shared guides remain unavailable. hive_context_get includes that same guide. Shared-only hive_context_get/guide_get/task calls are permission errors.

Own mel 69a570f1-536a-4f09-8dcb-c77e3bbb502c, name "Workshop invitation delivery", summary "Friday evening invitations worked last season; timing remains uncertain this season", content "Last season the Acme workshop invitation was sent Friday at 18:00. This season's invitation timing has not been tested." Tags convention. Shared mel c8640560-95ea-4310-9f55-704905494426, name "Community workshop attendance findings", summary "Childcare and Wednesday timing increased attendance in the neighborhood pilot", content "The neighborhood pilot compared Friday evening with Wednesday 10:00. Wednesday attendance rose from 12 to 23 participants when free childcare was included; interviews said childcare removed the largest attendance barrier. Offer free childcare, state its availability clearly, and use Wednesday 10:00 as the supported candidate. This evidence concerns the pilot, not a guarantee for Acme." Tags research; shared true; hive_id is the shared hive. mel_search workshop queries return both relevant mels unless shared-only scope. mel_get returns their full content, summary, hive_id, shared flag, related_mels and link_summary. Do not give full evidence in summaries.

mel_patch edits content only: preserve the summary, name, tags and all other fields. Match old_text exactly, replace once unless replace_all is true, and reject absent or ambiguous matches. mel_update changes only the supplied fields; omitted fields remain unchanged. Return the actual written id. Subsequent reads in the SAME RUN, including from an Agent child if it shares the mock server, must return the actual saved content; never pretend an independent agent read a correction that was not written. guide_edit/guide_patch update the own guide immediately and return hive_id, guide_updated_at, linked_mel_count, and own true. Shared writes fail. A guide patch whose old_text does not match fails; never manufacture success. The existing abort guards continue to apply.


## Protocol examples (part of the actual agent mock instructions)

Use these carrier and transition examples when answering, not a derived summary of a write. The unchanged summary after a content patch is intentional; a later summary change requires mel_update. IDs in these examples identify the own workshop mel.

```json
{
  "guide_get": {
    "hive_id": "3f018f58-2316-465d-84b6-a8f9327ce121",
    "guide": {
      "present": true,
      "content": "When drafting participant invitations, use plain language and do not invent an attendance target. Event observations belong in mels; multi-session logistics belong in tasks.",
      "updated_at": "2026-09-30T00:00:00Z",
      "links": []
    }
  },
  "mel_writes": {
    "before": {"id":"69a570f1-536a-4f09-8dcb-c77e3bbb502c","summary":"Friday timing remains uncertain","content":"Timing candidate: Friday 18:00","tags":["convention"]},
    "patch": {
      "input": {"id":"69a570f1-536a-4f09-8dcb-c77e3bbb502c","old_text":"Friday 18:00","new_text":"Wednesday 10:00"},
      "after": {"id":"69a570f1-536a-4f09-8dcb-c77e3bbb502c","summary":"Friday timing remains uncertain","content":"Timing candidate: Wednesday 10:00","tags":["convention"]}
    },
    "update": {
      "input": {"id":"69a570f1-536a-4f09-8dcb-c77e3bbb502c","summary":"Wednesday is the new candidate"},
      "after": {"id":"69a570f1-536a-4f09-8dcb-c77e3bbb502c","summary":"Wednesday is the new candidate","content":"Timing candidate: Wednesday 10:00","tags":["convention"]}
    }
  }
}
```

These examples fix protocol shape and omitted-field behavior; they are not independently verified workshop observations or instructions to save an unqualified factual correction. In both worlds, hive_context_get uses the same {present,content,updated_at,links} guide carrier; linked mels are in guide.links, not a separate linked_mels field. mel_search, including ids lookups, always returns summaries only, never full content; mel_get returns the body. task_search's related_mel_ids retain supported same-hive archived IDs while omitting missing and cross-hive IDs; task_get's resolved related_mels omit archived IDs. Task array writes replace, not append.
