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

// Compact pointer replacing the former inline 13-rule block (~5.5KB). The
// full canonical rules now live in the melxis-memory / melxis-task SKILL.md
// bodies (progressive disclosure: descriptions stay resident, bodies load on
// demand) — per Claude Code / Codex official guidance that hooks carry only
// dynamic context while durable rules belong to skills and server
// instructions. Only the irreducible reflexes are kept inline so they
// survive even when no skill is consulted.
const RULES_POINTER_BLOCK = `

## Memory Operating Rules (pointer)

Full rules live in the **melxis-memory** and **melxis-task** skills — consult them at semantic moments (saving or refining memory, linking, task start/closure, session end sweep). Judgment core (Recurrence × Inferability, push-not-pull) arrives with the Melxis MCP server instructions. Irreducible reflexes, valid even without loading the skills:
- Prefer \`mel_patch\` / \`mel_update\` on existing mels over creating near-duplicates; save in the same turn the insight appears, not at session end. Recall is a refinement trigger too: if a recalled mel is sharpened or corrected by the current turn's findings, patch it now.
- Contradiction → create a new mel + \`mel_link_create\` reason "supersedes"; never rewrite the contradicted mel.
- After \`mel_create\`, search related mels and propose links. 1 mel = 1 concept — split composites.
- User-reported observations get tags \`user-reported\` + \`needs-verification\`; hypotheses become verification tasks, not mel facts.
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
    // Sanitize before logging: the value is user-controlled env input, so
    // strip control characters and cap length to keep the log single-line.
    const safe = String(raw).replace(/[^\x20-\x7E]/g, '?').slice(0, 32);
    process.stderr.write(
      `melxis-hook[session-start]: unknown MELXIS_WRITE_POLICY "${safe}", falling back to "auto"\n`,
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
Call any write tool (incl. deletion) directly when intent is clear and judgement criteria (Recurrence likelihood × Inferability) are met. Do not ask for per-write confirmation. Editorial control belongs to the user at recall time (web UI list, supersession via \`mel_link_create\` reason="supersedes"). Note: \`mel_delete\` / \`task_delete\` are currently hard delete — Graphiti-aligned soft / bi-temporal invalidation is planned but not yet implemented.
`;
}

const STARTUP_BLOCK = `## Melxis Session Bootstrap

Melxis growing-memory is available via MCP. Restore cross-session context before responding to the first message and form a compact **session brief** in your working context.

1. Call \`mel_search(tags: ["project-orientation"])\` without a query to get memory-prior orientation candidates, and call \`hive_search(query: "<inferred project name>")\` using a project name inferred from local project context. Do not expose raw local details.
2. Resolve the hive from agreement/confidence across those two result sets. If \`hive_search\` resolves a hive that the first \`mel_search\` did not return, call \`mel_search(hive_ids: ["<resolved hive id>"], tags: ["project-orientation"])\` to recover that hive's orientation entrypoint.
3. If a hive is resolved, call \`task_search(hive_id: "<resolved hive id>", sort: "recency")\` without \`parent_task_id\` for recent-session handoff recovery. If both searches miss or candidates are ambiguous, do not run cross-hive \`task_search\`; ask the user to choose/create a hive only when substantive work needs project context.
4. Use the recovered context silently as the session brief. Routine Melxis bookkeeping stays silent; report MCP availability/auth/token/connection failures.
5. If a handoff task exists and recent progress is not reflected in it, refresh it via \`task_update\` (compressed current state, not append-only history; independently resumable remaining work becomes sub-tasks).
6. If the first request implies non-trivial multi-step work, anchor it BEFORE substantive implementation: \`task_update(status="in_progress")\` on a matching task, else \`task_create\`. Trivial one-shot edits may skip the anchor — but if skipped work grows (3+ tool calls, crosses turns, or surfaces a decision/root cause), anchor retroactively. Never let the task-anchor skip become a session-context skip.

IMPORTANT: This recovery is a hard precondition — execute step 1 before any other tool call or assistant text. If recovery returns no relevant context, proceed silently without announcing the miss.

Note: Melxis MCP tools may be deferred-loaded by your harness (schemas not pre-registered). If a required Melxis tool is not directly callable, load schemas first via your harness's tool-loading mechanism.
`;

const RESUME_BLOCK = `## Melxis Session Resumed

Session resumed. IMPORTANT: refreshing memory state is a hard precondition — execute step 1 before any other tool call or assistant text. Context from before the resume may be stale or summarized away; only recovery performed now counts.

1. Run the atomic recovery flow: \`mel_search(tags: ["project-orientation"])\` + \`hive_search(query: "<inferred project name>")\`, then scoped orientation lookup and \`task_search(hive_id, sort: "recency")\` if a hive is resolved.
2. Use the recovered handoff task and orientation context silently.
3. If progress is not reflected in the active task, refresh its compressed current state with \`task_update\`; split independently resumable remaining work into sub-tasks instead of appending everything to the parent.
`;

const COMPACT_BLOCK = `## Melxis Post-Compaction Recovery

Context was just compacted; rules and state may have been dropped. IMPORTANT: recovery is a hard precondition — execute step 1 before any other tool call or assistant text. Recovery from before the compaction does not count; the summary may have dropped it.

1. Run the atomic recovery flow: \`mel_search(tags: ["project-orientation"])\` + \`hive_search(query: "<inferred project name>")\`, then scoped orientation lookup and \`task_search(hive_id, sort: "recency")\` if a hive is resolved.
2. Use the recovered project/task/memory state silently.
3. If compaction lost recent task progress, refresh the active task's compressed current state and sub-task structure before continuing.
`;

const FALLBACK_BLOCK = `## Melxis Session Hook

Memory Operating Rules remain in effect. Use \`mel_search\` / \`task_search\` proactively as needed.
`;

try {
  const input = readStdinJson();
  const source = input.source ?? 'startup';

  if (source === 'startup' || source === 'clear') {
    emitText(STARTUP_BLOCK + MCP_FAILURE_BLOCK + RULES_POINTER_BLOCK + POLICY_BLOCK);
  } else if (source === 'resume') {
    emitText(RESUME_BLOCK + MCP_FAILURE_BLOCK + RULES_POINTER_BLOCK + POLICY_BLOCK);
  } else if (source === 'compact') {
    // Re-include the rules pointer and POLICY_BLOCK: both are cheap (~1KB)
    // and likely lost during compaction.
    emitText(COMPACT_BLOCK + MCP_FAILURE_BLOCK + RULES_POINTER_BLOCK + POLICY_BLOCK);
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
