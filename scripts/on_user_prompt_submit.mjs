#!/usr/bin/env node
// Hook: UserPromptSubmit
//
// Injects lightweight Melxis context recovery when recent transcript context
// does not show a Melxis recovery/tool call, and injects a "your FIRST tool
// action after recovery MUST anchor the task" directive when the user's prompt
// looks like multi-step work AND no Melxis task is currently active.
//
// Design constraints (consistent with the other Cut 4 hooks):
//   - Pure stdlib, Node ESM, no $HOME writes.
//   - Errors → STDERR + exit 0 so the hook never blocks the agent.
//   - Silent when not applicable (empty stdout = no injection).
import {
  readStdinJson,
  logError,
  readTranscriptTail,
  parseTranscript,
  hasActiveMelxisTask,
  hasToolCallMatching,
  hasToolCallMatchingAfterIndex,
  extractText,
  extractOperationCheckpoints,
  findLastCaptureAnchorIndex,
  findLastEntryIndexMatching,
  findLastSubstantialProgressIndex,
  hasTaskLikeContext,
  hasTaskUpdateAfterIndex,
} from './lib/melxis-hook.mjs';

// Multi-step work keywords. Kept conservative — these are verbs that imply
// the user is asking for a sequence of tool calls / file edits, not a quick
// one-shot Q&A. False negatives (missing the directive) are preferable to
// false positives (nagging on every chat turn).
const MULTI_STEP_PATTERN =
  /(実装|修正|調査|リファクタ|デバッグ|レビュー|分析|設計|追加|削除|統合|移行)|\b(implement|fix|investigate|refactor|debug|review|analyze|design|integrate|migrate)\b/i;

// Suppression keywords. If the user explicitly frames the work as trivial we
// stay quiet — the task anchor directive only earns its keep on real
// multi-step work.
const TRIVIAL_PATTERN = /(trivial|typo|簡単|ちょっと|軽く)/i;

const DIRECTIVE_TEMPLATE = (matched) =>
  `[melxis] This appears to be multi-step work (matched keywords: ${matched}).

Your FIRST action after Melxis context recovery MUST anchor the work in a Melxis task:
- If an existing task matches this work, call \`task_update\` to set it \`in_progress\` and refresh its compressed current state.
- If no existing task matches, call \`task_create\`.

Without the task anchor, task-start context recall, closure feedback, and bidirectional mel ⇄ task linking lose their fire point — progress stops flowing back into memory.

Skip task anchoring only if the work is genuinely trivial (typo, single-line fix, pure read-only Q&A). Read-only Q&A still needs session context recovery; do not let the task-anchor skip become a permanent session-context skip. If you proceed without task anchoring and then surface a root cause / decision / multi-step branch, update an existing matching task or create one retroactively.
`;

const BOOTSTRAP_TEMPLATE = `[melxis] Recent transcript context does not show Melxis context recovery.

Before answering the user's prompt, run the atomic Melxis recovery flow: call \`hive_search(query: "<inferred project name>")\` first — it gives \`own\` / \`owner_account_id\` per hive; identify hives by id + \`own\`, never by name (names collide across accounts). Infer the project name from local project context without exposing raw local details. Resolve the project's hive set — one own anchor hive (\`own: true\`) plus any shared hives (\`own: false\`, read-only mels) — and take your own account ids from the \`own: true\` results. Then call own-scoped \`mel_search(query: "<inferred project name>", tags: ["project-orientation"], owner_account_ids: [<own account ids>])\` for orientation. Only if an own anchor hive is resolved, call \`task_search(hive_id: "<own anchor hive id>", sort: "recency")\` without \`parent_task_id\` for handoff recovery — tasks are private to each account, so shared hives have none; with no own anchor, operate in shared-only mode and skip task recovery. If unresolved/ambiguous, do not run cross-hive \`task_search\`; ask the user to choose/create a hive only when substantive work needs project context. Use the recovered orientation, handoff task context, and evidence constraints (patch/update before create; user-reported needs verification; hypotheses become verification tasks) as a compact session brief; keep working recall blended (leave \`hive_ids\` / \`owner_account_ids\` unset in \`mel_search\`).

This is a lightweight recovery path for cleared/compacted context. Do not create or update memory from this reminder alone. Routine Melxis bookkeeping stays silent; report MCP availability/auth/token/connection failures.
`;

const CHECKPOINT_RECOVERY_TEMPLATE = `[melxis] Recent transcript suggests task-like progress may not be reflected in Melxis yet.

Before substantive work, silently refresh the active/relevant task if needed:
- Update the parent task description as compressed current state, not append-only history.
- Update status, priority, tags, and related_mel_ids when the current state changed.
- Keep the parent task as goal / why / Definition of Done; create or update sub-tasks for independently resumable remaining work with separate completion criteria.
- Do not create sub-tasks for ephemeral same-turn steps.
- If task-derived memory is durable, search existing mels first, prefer \`mel_patch\` / \`mel_update\`, use \`mel_create\` only for genuinely new memory, link with reason "extracted-from-task" where useful, and add relevant mel IDs back to the source task.
- User-reported observations need \`user-reported\` + \`needs-verification\`; hypotheses should become verification tasks, not mel facts.

Routine Melxis bookkeeping stays silent; do not explain a skip to the user.
`;

// Extract every matched keyword from the prompt so the injected directive
// quotes the actual signal back at the agent. Helps the agent self-audit
// (was this REALLY multi-step?) rather than blindly comply.
export function collectMatches(prompt) {
  const out = [];
  const re = new RegExp(MULTI_STEP_PATTERN.source, 'gi');
  let m;
  while ((m = re.exec(prompt)) !== null) {
    out.push(m[0]);
  }
  return Array.from(new Set(out));
}

export function shouldInjectDirective({ prompt, entries }) {
  if (typeof prompt !== 'string') return { inject: false };
  const trimmed = prompt.trim();
  if (trimmed.length < 20) return { inject: false, reason: 'short' };
  if (TRIVIAL_PATTERN.test(trimmed)) return { inject: false, reason: 'trivial' };
  if (hasActiveMelxisTask(entries)) return { inject: false, reason: 'active-task' };
  const matched = collectMatches(trimmed);
  if (matched.length === 0) return { inject: false, reason: 'no-keyword' };
  return { inject: true, matched };
}

// Any Melxis tool name, read or write. Tolerant of MCP registration prefixes:
// bare ("mel_search"), legacy ("mcp__melxis__mel_search"), and plugin-installed
// ("mcp__plugin_melxis_melxis__mel_create"). Write tools count as context —
// an agent that just called mel_create has obviously recovered context, and
// the previous read-only list caused false re-injection on write-heavy turns.
const MELXIS_TOOL_RE =
  /(?:^|[._-])(?:mel|task|hive)_(?:search|get|create|update|patch|delete|link_create|link_delete)(?:[._-]|$)|melxis/i;

// Session boundary = our own SessionStart hook output recorded in the
// transcript (entry types vary by client: hook_success / hook_additional_context).
// Using the emitted block titles keeps this stateless — the transcript itself
// carries the boundary, no state file needed.
const SESSION_BOUNDARY_RE =
  /Melxis Session (?:Bootstrap|Resumed|Hook)|Melxis Post-Compaction Recovery/;

// Our own prior injections, used for fire-once-per-boundary dedupe.
const BOOTSTRAP_NAG_RE = /does not show Melxis context recovery/;
const CHECKPOINT_NAG_RE = /task-like progress may not be reflected in Melxis yet/;

// Marker scans are restricted to hook-emitted entries (hookOnly): the
// literal marker strings also appear in tool_result / tool_use entries when
// this toolkit's own sources are read or edited, and in assistant prose that
// quotes the templates — systematically, in exactly the sessions that
// develop the toolkit. Only hook_success / hook_additional_context entries
// are authoritative for boundaries and prior nags.

export function hasMelxisContext(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (hasToolCallMatching(entries, MELXIS_TOOL_RE)) {
    return true;
  }
  const text = extractText(entries);
  return /\bMelxis Session Bootstrap\b|\bmelxis hive\b|project-orientation|Called plugin:melxis:melxis|Called plugin:melxis:memory|Called plugin:melxis:task/i.test(
    text,
  );
}

export function shouldInjectBootstrap({ prompt, entries }) {
  if (typeof prompt !== 'string') return { inject: false };
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.startsWith('/')) return { inject: false, reason: 'command-or-empty' };

  const boundaryIndex = findLastEntryIndexMatching(entries, SESSION_BOUNDARY_RE, { hookOnly: true });
  const nagIndex = findLastEntryIndexMatching(entries, BOOTSTRAP_NAG_RE, { hookOnly: true });

  if (boundaryIndex >= 0) {
    // Anchor the judgement to the last session boundary (startup/resume/
    // compact): only recovery that happened AFTER the boundary counts.
    // Recovery from before a compact/resume may be stale or summarized away.
    if (hasToolCallMatchingAfterIndex(entries, MELXIS_TOOL_RE, boundaryIndex)) {
      return { inject: false, reason: 'recovered-after-boundary' };
    }
    // Fire once per boundary: if we already reminded and the model still has
    // not recovered, repeating the same text only burns tokens (instruction
    // habituation). The next boundary resets the budget.
    if (nagIndex > boundaryIndex) {
      return { inject: false, reason: 'nagged-after-boundary' };
    }
    return { inject: true, reason: 'boundary-without-recovery' };
  }

  // No boundary marker in the tail window: the SessionStart hook may be
  // missing/untrusted, or a long session scrolled it out. Fall back to
  // content-based detection, still capped at one reminder per tail window.
  if (hasMelxisContext(entries)) return { inject: false, reason: 'context-present' };
  if (nagIndex >= 0) return { inject: false, reason: 'already-nagged' };
  return { inject: true, reason: 'no-context' };
}

export function shouldInjectCheckpointRecovery({ entries }) {
  if (!Array.isArray(entries) || entries.length === 0) return { inject: false, reason: 'empty' };
  if (!hasTaskLikeContext(entries)) return { inject: false, reason: 'no-task-context' };

  const operationCheckpoints = extractOperationCheckpoints(entries);
  const lastOperationCheckpointIndex = operationCheckpoints.reduce(
    (max, checkpoint) => Math.max(max, checkpoint.entryIndex ?? -1),
    -1,
  );
  const lastCaptureAnchorIndex = findLastCaptureAnchorIndex(entries);
  const lastProgressIndex = findLastSubstantialProgressIndex(entries);
  const hasDecisionSignal = lastCaptureAnchorIndex >= 0;
  const hasProgressSignal = lastProgressIndex >= 0;
  const hasOperationCheckpoint = operationCheckpoints.length >= 1;

  if (!hasOperationCheckpoint && !hasProgressSignal && !hasDecisionSignal) {
    return { inject: false, reason: 'no-checkpoint-signal' };
  }

  const anchorIndex = Math.max(lastOperationCheckpointIndex, lastCaptureAnchorIndex, lastProgressIndex);
  if (hasTaskUpdateAfterIndex(entries, anchorIndex)) {
    return { inject: false, reason: 'task-update-after-checkpoint' };
  }

  // Fire once per checkpoint signal: if we already reminded after this anchor
  // and no task_update followed, repeating the reminder every turn is noise.
  // New progress creates a newer anchor and re-arms the reminder.
  const checkpointNagIndex = findLastEntryIndexMatching(entries, CHECKPOINT_NAG_RE, { hookOnly: true });
  if (checkpointNagIndex > anchorIndex) {
    return { inject: false, reason: 'nagged-after-checkpoint' };
  }

  return { inject: true };
}

export function buildAdditionalContext({ prompt, entries }) {
  const blocks = [];
  const bootstrap = shouldInjectBootstrap({ prompt, entries });
  if (bootstrap.inject) blocks.push(BOOTSTRAP_TEMPLATE);

  const checkpoint = shouldInjectCheckpointRecovery({ entries });
  if (checkpoint.inject) blocks.push(CHECKPOINT_RECOVERY_TEMPLATE);

  const directive = shouldInjectDirective({ prompt, entries });
  if (directive.inject) blocks.push(DIRECTIVE_TEMPLATE(directive.matched.join(', ')));

  // Stateless trigger observability: opt-in stderr trace of every decision so
  // firing reliability can be measured from logs instead of anecdote.
  if (process.env.MELXIS_HOOK_DEBUG === '1') {
    process.stderr.write(
      `melxis-hook[user-prompt-submit]: bootstrap=${bootstrap.inject ? 'fire' : bootstrap.reason} ` +
        `checkpoint=${checkpoint.inject ? 'fire' : checkpoint.reason} ` +
        `directive=${directive.inject ? 'fire' : directive.reason}\n`,
    );
  }

  return blocks.join('\n');
}

// Guard: skip the main flow when imported by the test runner. The test file
// imports collectMatches / shouldInjectDirective and does not want the hook
// to attempt to read stdin.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const input = readStdinJson();
    const prompt = input.prompt ?? '';
    const transcriptPath = input.transcript_path ?? '';
    const lines = readTranscriptTail(transcriptPath, 200);
    const entries = parseTranscript(lines);
    const additionalContext = buildAdditionalContext({ prompt, entries });
    if (additionalContext) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext,
          },
        }) + '\n',
      );
    }
  } catch (err) {
    logError('user-prompt-submit', err);
  }
  process.exit(0);
}
