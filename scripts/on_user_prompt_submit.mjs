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
  extractText,
  extractOperationCheckpoints,
  findLastCaptureAnchorIndex,
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

Without the task anchor, Rules 6/7/8 (start/closure/bidirectional) lose their fire point and the loop breaks at stage 4 (Feedback).

Skip task anchoring only if the work is genuinely trivial (typo, single-line fix, pure read-only Q&A). Read-only Q&A still needs session context recovery; do not let the task-anchor skip become a permanent session-context skip. If you proceed without task anchoring and then surface a root cause / decision / multi-step branch, update an existing matching task or create one retroactively.
`;

const BOOTSTRAP_TEMPLATE = `[melxis] Recent transcript context does not show Melxis context recovery.

Before answering the user's prompt, run the atomic Melxis recovery flow: call \`mel_search(tags: ["project-orientation"])\` without a query and \`hive_search(query: "<inferred project name>")\`, using a project name inferred from local project context without exposing raw local details. Resolve the hive from agreement/confidence; if \`hive_search\` resolves a hive not returned by the orientation search, run \`mel_search(hive_ids: ["<resolved hive id>"], tags: ["project-orientation"])\`. If a hive is resolved, call \`task_search(hive_id: "<resolved hive id>", sort: "recency")\` without \`parent_task_id\` for recent-session handoff recovery. If unresolved/ambiguous, do not run cross-hive \`task_search\`; ask the user to choose/create a hive only when substantive work needs project context. Use the recovered orientation, handoff task context, and evidence constraints (patch/update before create; user-reported needs verification; hypotheses become verification tasks) as a compact session brief.

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

export function hasMelxisContext(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (
    hasToolCallMatching(
      entries,
      /(?:^|[._-])(?:mel_search|task_search|hive_search|mel_get|task_get)(?:[._-]|$)|mcp__melxis__/,
    )
  ) {
    return true;
  }
  const text = extractText(entries);
  return /\bMelxis Session Bootstrap\b|\bMelxis context recovery\b|\bmelxis hive\b|project-orientation|Called plugin:melxis:melxis|Called plugin:melxis:memory|Called plugin:melxis:task/i.test(
    text,
  );
}

export function shouldInjectBootstrap({ prompt, entries }) {
  if (typeof prompt !== 'string') return { inject: false };
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.startsWith('/')) return { inject: false, reason: 'command-or-empty' };
  if (hasMelxisContext(entries)) return { inject: false, reason: 'context-present' };
  return { inject: true };
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
