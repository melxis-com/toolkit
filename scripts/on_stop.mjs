#!/usr/bin/env node
// Hook: Stop
//
// Fires when the assistant finishes responding. Heuristic-gated reminder
// pointing back to the Memory Operating Rules established at SessionStart.
// Silent by default — only fires when decision/insight signals exist
// without a recent save (capture reminder), or when closure feedback appears
// incomplete (closure reminder). Operation checkpoints (e.g. git commit/push
// tool calls) are treated as milestone signals that reinforce, but do not
// replace, the LLM's save judgement.
//
// Cut 4 changes (vs v0.8 bash):
//   - Stateless: no $HOME write, no per-session JSON file. State (last
//     reminder, signal totals) is derived from transcript_path on each call.
//   - G1 (quoted signals) — preserved.
//   - G4 (closure detection) — preserved, transcript-derived.
//   - G2 (600s throttle) and G3 (state file) — REMOVED.
//     "Soft-injection immunity" (mel `b1dd0ee0` #4) is mitigated instead by
//     (a) signal-gated emission (silent on signal-free turns),
//     (b) compressed reminder text (1-3 lines),
//     (c) dynamic G1 quote so the prompt is grounded in the current turn.
//
// Always honors stop_hook_active to avoid infinite loops.
import {
  readStdinJson,
  readTranscriptTail,
  parseTranscript,
  extractText,
  extractOperationCheckpoints,
  hasToolCallMatching,
  hasToolCallMatchingAfterIndex,
  PATTERNS,
  captureMatches,
  emitText,
  logError,
} from './lib/melxis-hook.mjs';

function emitCaptureReminder(samples) {
  const quoted = samples.length ? samples.join('\n') + '\n' : '';
  emitText(
    `This turn surfaced a decision or insight not yet persisted to Melxis. Quoted signals:
${quoted}
Apply Memory Operating Rules:
- **In-moment capture** (Rule 2) — propose save in this turn; do not defer. Apply Recurrence likelihood + Inferability criteria.
- **Core insight** (Rule 9) — extract WHY, not WHAT.
- **Retroactive evolution** (Rule 1) — prefer \`mel_patch\` over near-duplicate \`mel_create\`.

Skip if the content was trivial. Write behavior follows the active \`MELXIS_WRITE_POLICY\` (set at session start; default \`auto\`).`
  );
}

function emitClosureReminder(samples) {
  const quoted = samples.length ? samples.join('\n') + '\n' : '';
  emitText(
    `This turn contains a task closure signal but no Melxis memory feedback write was observed. Quoted signals:
${quoted}
Apply Memory Operating Rules:
- **Task closure feedback** (Rule 7) — evaluate the conversation log, task trace, tool activity, and related mels.
- If durable feedback exists, prefer refining existing memory first (\`mel_patch\` / \`mel_update\`), or create a new mel when it is genuinely new; link with reason \`extracted-from-task\` where useful.
- Also consider task granularity lessons and adding relevant mel IDs back to the source task. Skip when nothing is reusable.

Write behavior follows the active \`MELXIS_WRITE_POLICY\` (default \`auto\`).`
  );
}

function emitOperationCheckpointReminder(checkpoints) {
  const kinds = [...new Set(checkpoints.map((checkpoint) => checkpoint.kind))].join(', ');
  emitText(
    `This turn reached an operation checkpoint (${kinds}) but no Melxis task/memory update was observed after it.

Apply Memory Operating Rules:
- Treat the checkpoint as a milestone signal, not an automatic save.
- If active work maps to a Melxis task, \`task_search\` / \`task_get\` and update status or related context if appropriate.
- If the trace contains durable insight (WHY) or reusable procedure (HOW), create/link mels using \`extracted-from-task\` or \`part-of\` as appropriate.

Skip if the operation was trivial or already reflected in Melxis. Write behavior follows the active \`MELXIS_WRITE_POLICY\` (default \`auto\`).`
  );
}

try {
  const input = readStdinJson();
  if (input.stop_hook_active) {
    process.exit(0);
  }

  const lines = readTranscriptTail(input.transcript_path, 200);
  if (!lines.length) {
    process.exit(0);
  }

  const entries = parseTranscript(lines);
  const text = extractText(entries);
  const operationCheckpoints = extractOperationCheckpoints(entries);
  const lastOperationCheckpointIndex = operationCheckpoints.reduce(
    (max, checkpoint) => Math.max(max, checkpoint.entryIndex ?? -1),
    -1,
  );

  // Signal extraction. Combine matched lines from decision + insight patterns
  // for the capture reminder, and closure separately for closure reminder.
  const decision = captureMatches(text, PATTERNS.decision, 2);
  const insight = captureMatches(text, PATTERNS.insight, 2);
  const closure = captureMatches(text, PATTERNS.closure, 3);

  // PATTERNS.save is non-global; we only need presence/absence (the count is
  // never used for ranking, only as a "did the agent already save?" gate).
  const hasSave =
    PATTERNS.save.test(text) ||
    hasToolCallMatching(
      entries,
      /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/,
    );
  const hasSaveAfterLastOperationCheckpoint =
    lastOperationCheckpointIndex >= 0 &&
    hasToolCallMatchingAfterIndex(
      entries,
      /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/,
      lastOperationCheckpointIndex,
    );
  const hasMemoryFeedback =
    /(mel_create|mel_update|mel_patch|mel_link_create)/.test(text) ||
    hasToolCallMatching(
      entries,
      /(?:^|[._-])(mel_create|mel_update|mel_patch|mel_link_create)(?:[._-]|$)/,
    );
  const taskCompleted = PATTERNS.taskCompleted.test(text);

  const captureSignals = decision.count + insight.count;
  // Dedupe quoted samples: a single line can match both decision and insight
  // patterns (e.g. "決めた... root cause was X"), and we don't want to quote
  // the same line twice.
  const captureSamples = [...new Set([...decision.samples, ...insight.samples])].slice(0, 3);

  // Capture reminder: signal-gated, no throttle. Emit if any decision/insight
  // signal exists in the recent window AND no save call was observed.
  if (captureSignals >= 1 && !hasSave) {
    emitCaptureReminder(captureSamples);
  }

  // Closure feedback reminder: signal-gated, independent of capture.
  // A task_update(completed/cancelled) closes the task but does not by itself
  // prove that conversation/task/artifact feedback was evaluated into memory.
  if ((closure.count >= 1 || taskCompleted) && !hasMemoryFeedback) {
    emitClosureReminder(closure.samples);
  }

  // Operation checkpoint reminder: command-tool-only, transcript-derived.
  // This does not require git to exist locally; it only observes commands the
  // agent already attempted to run and asks the agent to evaluate Melxis state.
  if (operationCheckpoints.length >= 1 && !hasSaveAfterLastOperationCheckpoint) {
    emitOperationCheckpointReminder(operationCheckpoints);
  }
} catch (err) {
  logError('stop', err);
}

process.exit(0);
