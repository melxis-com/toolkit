#!/usr/bin/env node
// Hook: SessionStart (matcher: startup|resume|compact|clear)
//
// Bootstraps Melxis growing-memory context at session start. Output is
// injected into the LLM context so the agent proactively calls Melxis MCP
// tools (hive_search / mel_search / task_search) and applies the Memory
// Operating Rules at semantic moments.
//
// Cut 4: Node ESM, no jq, no $HOME writes. Pure prompt injection (does NOT
// call mcp.melxis.com directly — OAuth-gated, distribution unifies on MCP
// standard auth).
import { readStdinJson, emitText, logError } from './lib/melxis-hook.mjs';

const RULES_BLOCK = `

## Memory Operating Rules

Capture at semantic moments. Consolidate when semantic events fire (refinement, contradiction, hub formation, task closure). Session End is a fallback sweep, not a primary phase.

**Trigger rules**
1. **Retroactive evolution** — After \`mel_search\` surfaces existing mels, OR when a draft mel created earlier in the same session is being refined by the conversation, evaluate whether the conversation refines them. If yes, prefer targeted \`mel_patch\` calls (text-level edits, one per localized change) over creating near-duplicates or batching refinements until Session End. Reach for \`mel_update\` only when name / summary / tags need to change, or when content is restructured beyond targeted replacement.
2. **In-moment capture** — When the user expresses a decision, root cause, or insight, propose save in that same turn. Do not wait for Stop or Session End. Triggers include both **positive** ("採用した", "決めた", "確定", "let's go with", "we'll use", "settled on", "OK") and **negative** ("原因は", "the bug was", "root cause") signals. Apply two judgement criteria: **Recurrence likelihood** (will this come up again across sessions?) and **Inferability** (could a future agent reconstruct this from code or git alone?). Save when likely-to-recur AND non-inferable. Refinements to same-session drafts follow this rule too — \`mel_patch\` in the same turn, not at Session End.
3. **Hub formation** — Immediately after \`mel_create\`, search for related mels and propose \`mel_link_create\` with a short reason. The memory graph grows through links.
4. **Non-destructive supersession** — If new information contradicts an existing mel, do NOT modify it (neither \`mel_patch\` nor \`mel_update\`). Create a new mel and link with reason \`supersedes\`. Refinement → patch / update; contradiction → supersedes.
5. **MOC candidate** — When a mel collects many links, recurs in searches, or 3+ mels point to the same theme, flag the hub mel to the user as a Map of Content (MOC) candidate. The hub is named, summarized, and lists the mels it organizes.
6. **Task start (recover context)** — When \`task_update\` sets status to \`in_progress\`, recall context before acting: \`mel_search\` the task topic, then **batch-hydrate related mels in one call**. If you loaded the task via \`task_get\` (returns resolved \`related_mels\`), use \`mel_search(ids: related_mels.map(m => m.id))\`; if via \`task_search\` (raw \`related_mel_ids\`), use \`mel_search(ids: related_mel_ids)\` directly. Either way, do not call \`mel_get\` per id. Use \`mel_get\` only for the specific mels whose full content (not just summary) you need to act on. The next agent should resume from loaded context, not from a cold reading.
7. **Task closure feedback** — When the user signals work completion (e.g. "shipped", "pushed", "done", "完了", "できた") or \`task_update\` is called with status \`completed\`/\`cancelled\`:
   - Propose \`task_update\` to \`completed\` if not already set.
   - Evaluate the conversation log, task trace, tool activity, and related mels.
   - **Existing memory refinement** — prefer \`mel_patch\` / \`mel_update\` when feedback corrects, narrows, or sharpens an existing mel.
   - **Insight extraction (WHY)** — if the feedback is genuinely new and durable (a design decision, root cause, or anti-pattern), use \`mel_create\` (tag e.g. \`design-decision\`, \`bug-fix\`, \`anti-pattern\`) and link with reason \`extracted-from-task\`.
   - **Procedure extraction (HOW)** — if the feedback is a reusable procedural pattern (a recipe / convention worth applying to similar future tasks), use \`mel_create\` (tag \`convention\`) and link with reason \`extracted-from-task\`.
   - **Granularity audit** — if the completed/cancelled task turned out to contain multiple independently resumable intentions, different owners/surfaces, or separate completion criteria, capture the split pattern as a reusable procedure or anti-pattern.
8. **Bidirectional link** — Whenever \`task_create\` or \`task_update\` adds \`related_mel_ids\`, also propose \`mel_link_create\` between those mels (reason: \`part-of\`) so design context is dense in the mel graph, not only in the task. Symmetrically, when closure feedback updates or creates relevant memory, propose adding the relevant mel ID to the active task's \`related_mel_ids\` (read-modify-write — \`task_get\` returns resolved \`related_mels\`, so map back to ids via \`related_mels.map(m => m.id)\` before passing to \`task_update\`; arrays are replaced, not appended).

**Quality rules**
9. **Core insight** — A mel represents understanding, not events. Extract WHY, not WHAT. Lead with the insight; evidence is supporting context.
10. **Atomicity** — 1 mel = 1 concept. If the target is composite, split into multiple mels and link them.
11. **Vocabulary discipline**
    - Tags: \`design-decision\` / \`bug-fix\` / \`convention\` / \`anti-pattern\` / \`user-preference\` / \`project-orientation\` (extend only when none fit)
    - Link reasons: \`supersedes\` / \`refines\` / \`contradicts\` / \`part-of\` / \`uses\` / \`extracted-from-task\` (one per link)

Reads are encouraged proactively. Write behavior follows the active **Write policy** block below — do not assume an "ask first" default.
`;

const MCP_FAILURE_BLOCK = `
## MCP connection failures

If Melxis MCP tools are unavailable, or a Melxis MCP call fails because of authentication, token, or connection errors, tell the user explicitly. Do not silently continue as if memory or tasks were checked. Ask the user to reconnect or sign in to Melxis MCP, then retry the Melxis read/write call after they confirm. On Codex CLI, suggest \`codex mcp login melxis\`.
`;

// Write policy. SoT for melxis write-confirmation behavior. Selected via the
// MELXIS_WRITE_POLICY env var (default 'auto'). Consumers in different
// environments (CI, regulated industries, individual users) can override
// without forking the toolkit.
//
// Design rationale: ADR mel a05e9e81 — academic foundation 6 pillars
// (Zettelkasten / A-MEM / LYT / MemRL / MemOS / Graphiti) and 5 industry
// products (Mem0 / Supermemory / Letta / Zep / ChatGPT) all default to
// auto-save without per-write user confirmation. ask-first was misaligned
// with both. Deletion follows the same policy (no carve-out): industry
// agrees deletion is not special; safety lives in the data model
// (Graphiti-aligned soft delete is mid-term work) not in agent gating.

/** @typedef {'auto' | 'smart' | 'confirm'} WritePolicy */

/**
 * Resolve and validate the active write policy. Unknown values fall back to
 * 'auto' and emit a stderr warning so drift is observable (same observability
 * pattern as the unknown-source emit below).
 * @returns {WritePolicy}
 */
function resolveWritePolicy() {
  const raw = process.env.MELXIS_WRITE_POLICY;
  if (raw === 'auto' || raw === 'smart' || raw === 'confirm') return raw;
  if (raw !== undefined && raw !== '') {
    process.stderr.write(
      `melxis-hook[session-start]: unknown MELXIS_WRITE_POLICY "${raw}", falling back to "auto"\n`,
    );
  }
  return 'auto';
}
const WRITE_POLICY = resolveWritePolicy();

let POLICY_BLOCK;
if (WRITE_POLICY === 'confirm') {
  POLICY_BLOCK = `
## Write policy: confirm
Before any write tool call (\`mel_create\` / \`mel_update\` / \`mel_patch\` / \`mel_link_create\` / \`mel_delete\` / \`mel_link_delete\` / \`task_create\` / \`task_update\` / \`task_delete\`), state the target and intent and wait for the user's explicit "yes". Do not call the tool until confirmation arrives. This applies uniformly to create/update/delete — there is no carve-out for deletion.
`;
} else if (WRITE_POLICY === 'smart') {
  POLICY_BLOCK = `
## Write policy: smart
For all write tools (incl. deletion): when judgement is clear (Recurrence likelihood AND Inferability gap clearly met for create/update; clear contradiction or supersession rationale for delete), call the tool directly. When any signal is ambiguous, state the candidate and ask once. The LLM is the borderline arbiter, not the user.
`;
} else {
  // auto (default)
  POLICY_BLOCK = `
## Write policy: auto
Call any write tool (incl. deletion) directly when intent is clear and judgement criteria (Recurrence likelihood × Inferability) are met. Do not ask for per-write confirmation. Editorial control belongs to the user at recall time (web UI list, supersession via \`mel_link_create\` reason="supersedes", utility-driven decay). Note: \`mel_delete\` / \`task_delete\` are currently hard delete — Graphiti-aligned soft / bi-temporal invalidation is planned but not yet implemented.
`;
}

const STARTUP_BLOCK = `## Melxis Session Bootstrap

Melxis growing-memory is connected via MCP. Restore cross-session context before responding to the first message:

1. Call \`mel_search\` with project-context keywords (cwd basename, repo name) and \`tags=["project-orientation"]\`, \`limit=5\`. Omit \`hive_ids\` — that searches across every hive accessible to you in a single call.
2. If a project-orientation mel surfaces, use its hive as the project hive: call \`task_search\` with \`status="in_progress"\`, \`parent_task_id="root"\`, and that hive_id. Follow the orientation mel's scope and tagging conventions for the rest of the session.
3. If no orientation surfaces, fall back to \`hive_search\` to see what's available. Ask the user once which hive to use (or whether to create one). On confirmation, propose a project-orientation mel as the first entry so this question never recurs.

IMPORTANT: This bootstrap is a hard precondition — execute step 1 (\`mel_search\` with \`tags=["project-orientation"]\`) before any other tool call or assistant text. The judgment of relevance applies to the SEARCH RESULTS, not to whether to run the search. If results are empty or irrelevant, proceed silently — do not announce the miss.

Note: Melxis MCP tools may be deferred-loaded by your harness (schemas not pre-registered). If \`mel_search\` is not directly callable, load schemas first via your harness's tool-loading mechanism (Claude Code: ToolSearch with \`select:mel_search,task_search,hive_search,mel_get\`) before step 1.
`;

const RESUME_BLOCK = `## Melxis Session Resumed

Session resumed. Refresh memory state before continuing:

1. Call \`mel_search\` for recent updates relevant to the current task.
2. Call \`task_search\` with \`status="in_progress"\` to verify ongoing work.

Memory Operating Rules established at session start remain in effect.
`;

const COMPACT_BLOCK = `## Melxis Post-Compaction Recovery

Context was just compacted; rules and state may have been dropped. Recover via Melxis:

1. Call \`mel_search\` with queries about the work in progress.
2. Call \`task_search\` to verify task state.

Memory Operating Rules (rules 1-11, including Task start context recall, Task closure → mel extraction with reason "extracted-from-task", and bidirectional mel ⇌ task linking) remain in effect; reload via \`mel_search\` if details are needed.
`;

const FALLBACK_BLOCK = `## Melxis Session Hook

Memory Operating Rules remain in effect. Use \`mel_search\` / \`task_search\` proactively as needed.
`;

try {
  const input = readStdinJson();
  const source = input.source ?? 'startup';

  if (source === 'startup' || source === 'clear') {
    emitText(STARTUP_BLOCK + MCP_FAILURE_BLOCK + RULES_BLOCK + POLICY_BLOCK);
  } else if (source === 'resume') {
    emitText(RESUME_BLOCK + MCP_FAILURE_BLOCK + POLICY_BLOCK);
  } else if (source === 'compact') {
    // Compaction event: prior summary already retained rule references.
    // Emit a short re-anchor instead of doubling the instruction budget.
    // Re-include POLICY_BLOCK because it was likely lost during compaction.
    emitText(COMPACT_BLOCK + MCP_FAILURE_BLOCK + POLICY_BLOCK);
  } else {
    // Unrecognized source: fall through to a minimal anchor so the hook
    // never produces zero output silently. Log to stderr so harness drift
    // (a new SessionStart source value not yet handled) is observable
    // without polluting the agent's prompt context. Append POLICY_BLOCK so
    // the active write policy is never silently dropped on an unknown
    // source value (e.g. a future Claude Code source like "tool_use" or
    // "interrupt") — otherwise the agent would default to its model prior,
    // which is the regression this surface was designed to eliminate.
    process.stderr.write(`melxis-hook[session-start]: unknown source "${source}"\n`);
    emitText(FALLBACK_BLOCK + MCP_FAILURE_BLOCK + POLICY_BLOCK);
  }
} catch (err) {
  logError('session-start', err);
}

process.exit(0);
