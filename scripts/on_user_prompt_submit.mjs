#!/usr/bin/env node
// Hook: UserPromptSubmit
//
// Injects a "your FIRST tool call after bootstrap MUST be task_create" directive
// when the user's prompt looks like multi-step work AND no Melxis task is
// currently active. The directive complements the SessionStart STARTUP_BLOCK
// step 2 wording — that block fires only on the first turn, while this hook
// catches subsequent prompts that introduce new multi-step work mid-session.
//
// Design constraints (consistent with the other Cut 4 hooks):
//   - Pure stdlib, Node ESM, no $HOME writes.
//   - Errors → STDERR + exit 0 so the hook never blocks the agent.
//   - Silent when not applicable (empty stdout = no injection).
import {
  readStdinJson,
  emitText,
  logError,
  readTranscriptTail,
  parseTranscript,
  hasActiveMelxisTask,
} from './lib/melxis-hook.mjs';

// Multi-step work keywords. Kept conservative — these are verbs that imply
// the user is asking for a sequence of tool calls / file edits, not a quick
// one-shot Q&A. False negatives (missing the directive) are preferable to
// false positives (nagging on every chat turn).
const MULTI_STEP_PATTERN =
  /(実装|修正|調査|リファクタ|デバッグ|レビュー|分析|設計|追加|削除|統合|移行)|\b(implement|fix|investigate|refactor|debug|review|analyze|design|integrate|migrate)\b/i;

// Suppression keywords. If the user explicitly frames the work as trivial we
// stay quiet — the task_create directive only earns its keep on real
// multi-step work.
const TRIVIAL_PATTERN = /(trivial|typo|簡単|ちょっと|軽く)/i;

const DIRECTIVE_TEMPLATE = (matched) =>
  `[melxis] This appears to be multi-step work (matched keywords: ${matched}).

Your FIRST tool call after Melxis bootstrap (project-orientation mel_search) MUST be \`task_create\` to anchor the work in a Melxis task. Without the task anchor, Rules 6/7/8 (start/closure/bidirectional) lose their fire point and the loop breaks at stage 4 (Feedback).

Skip only if the work is genuinely trivial (typo, single-line fix, pure read-only Q&A). If you proceed without task_create and then surface a root cause / decision / multi-step branch, the miscalibration signal in STARTUP_BLOCK applies: create the task retroactively.
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
    const result = shouldInjectDirective({ prompt, entries });
    if (result.inject) {
      emitText(DIRECTIVE_TEMPLATE(result.matched.join(', ')));
    }
  } catch (err) {
    logError('user-prompt-submit', err);
  }
  process.exit(0);
}
