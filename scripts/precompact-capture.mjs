#!/usr/bin/env node
// Hook: PreCompact
//
// Fires before Claude Code compacts context. Reads the session transcript,
// detects likely unsaved project knowledge (decisions, bug root causes,
// unfinished multi-step work), and injects a reminder via
// `additionalContext` if such content exists AND no recent saves are seen.
//
// Cut 4: Node ESM, no jq / no python3 dependency. Pure stdlib.
//
// Design principles:
//   - Silent by default — only speak up when there is genuine value at risk.
//   - Lightweight — no LLM call, no network; pure keyword heuristic.
//   - Respectful — never blocks compaction. The agent judges what to save.
import {
  readStdinJson,
  readTranscriptTail,
  parseTranscript,
  extractText,
  PATTERNS,
  logError,
} from './lib/melxis-hook.mjs';

const TASK_PATTERN = /(multi-step|next step|\bTODO\b|タスク|計画|残り|handoff|tomorrow)/i;

try {
  const input = readStdinJson();
  // Symmetry with on_stop.mjs's stop_hook_active guard: future harness
  // versions may add a pre_compact_hook_active flag for re-entry safety.
  if (input.pre_compact_hook_active) {
    process.exit(0);
  }
  const lines = readTranscriptTail(input.transcript_path, 200);
  if (!lines.length) {
    process.exit(0);
  }

  const entries = parseTranscript(lines);
  const text = extractText(entries);

  const decisionMatches = (text.match(new RegExp(PATTERNS.decision, 'gi')) || []).length;
  const insightMatches = (text.match(new RegExp(PATTERNS.insight, 'gi')) || []).length;
  const taskMatches = (text.match(new RegExp(TASK_PATTERN, 'gi')) || []).length;
  const saveMatches = (text.match(new RegExp(PATTERNS.save, 'g')) || []).length;

  const signalTotal = decisionMatches + insightMatches + taskMatches;

  if (signalTotal >= 2 && saveMatches < 1) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          additionalContext:
            'Context is about to compact. The session appears to contain project knowledge or unfinished work that has not been saved to Melxis. Consider invoking the melxis-memory skill to preserve decisions, rationale, or bug root causes, or melxis-task for unfinished multi-step work — before the compaction discards details.',
        },
      }) + '\n'
    );
  }
} catch (err) {
  logError('pre-compact', err);
}

process.exit(0);
