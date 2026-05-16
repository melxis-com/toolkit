#!/usr/bin/env node
// Hook: UserPromptSubmit
//
// Injects lightweight Melxis context recovery when recent transcript context
// does not show a Melxis bootstrap/tool call, and injects a "your FIRST tool
// action after bootstrap MUST anchor the task" directive when the user's prompt
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

Your FIRST action after Melxis bootstrap (project-orientation mel_search + task_search) MUST anchor the work in a Melxis task:
- If an existing task matches this work, call \`task_update\` to set it \`in_progress\` and refresh its compressed current state.
- If no existing task matches, call \`task_create\`.

Without the task anchor, Rules 6/7/8 (start/closure/bidirectional) lose their fire point and the loop breaks at stage 4 (Feedback).

Skip only if the work is genuinely trivial (typo, single-line fix, pure read-only Q&A). If you proceed without task anchoring and then surface a root cause / decision / multi-step branch, the miscalibration signal in STARTUP_BLOCK applies: update an existing matching task or create one retroactively.
`;

const BOOTSTRAP_TEMPLATE = `[melxis] Recent transcript context does not show Melxis bootstrap/context recovery.

Before answering the user's prompt, restore project context and form a compact session brief:
1. Call \`mel_search\` with project-context keywords (cwd basename, repo name) and \`tags=["project-orientation"]\`, \`limit=5\`. Omit \`hive_ids\`.
2. If a project-orientation mel surfaces, call \`task_search\` for active/relevant tasks in that hive. Prefer resuming an existing matching task via \`task_update(status="in_progress")\` over creating a duplicate task.
3. Build the session brief from project-orientation, active/relevant tasks, task-related or high-link mels, and evidence constraints (patch/update before create; user-reported needs verification; hypotheses become verification tasks).
4. Use the session brief silently. If search results are empty or irrelevant, proceed normally without announcing the miss.

This is a lightweight recovery path for cleared/compacted context; do not create or update memory from this reminder alone.
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
  return /\bMelxis Session Bootstrap\b|\bmelxis hive\b|project-orientation|Called plugin:melxis:melxis|Called plugin:melxis:memory|Called plugin:melxis:task/i.test(
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

export function buildAdditionalContext({ prompt, entries }) {
  const blocks = [];
  const bootstrap = shouldInjectBootstrap({ prompt, entries });
  if (bootstrap.inject) blocks.push(BOOTSTRAP_TEMPLATE);

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
