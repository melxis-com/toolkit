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
  hasToolCallMatchingAfterIndex,
  hasTaskRelatedMelUpdateAfterIndex,
  findLastCaptureAnchorIndex,
  findLastClosureAnchorIndex,
  PATTERNS,
  captureMatches,
  emitText,
  logError,
} from './lib/melxis-hook.mjs';

function emitCaptureReminder(samples) {
  const quoted = samples.length ? samples.join('\n') + '\n' : '';
  emitText(
    `This turn surfaced a decision, insight, preference, or correction not yet persisted to Melxis. Quoted signals:
${quoted}
Apply Memory Operating Rules:
- **In-moment capture** (Rule 2) — propose save in this turn; do not defer. Apply Recurrence likelihood + Inferability criteria.
- **Core insight** (Rule 9) — extract WHY, not WHAT.
- **Retroactive evolution** (Rule 1) — search existing mels first; prefer \`mel_patch\` / \`mel_update\` over near-duplicate \`mel_create\`.
- **Signal → action** — decisions/preferences can become decisions; verified root causes can become bug-fix memory; corrections usually refine existing memory; user-reported observations need \`user-reported\` + \`needs-verification\`; hypotheses should become verification tasks, not mel facts.

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
- Preserve evidence status: user-reported closure observations need \`user-reported\` + \`needs-verification\`; hypotheses belong in concrete verification tasks, not mel facts.
- Also consider task granularity lessons and adding relevant mel IDs back to the source task. Skip when nothing is reusable.

Write behavior follows the active \`MELXIS_WRITE_POLICY\` (default \`auto\`).`
  );
}

function emitEcosystemBacklinkReminder() {
  emitText(
    `Closure memory feedback was observed, but the Melxis task anchor was not linked back to the relevant mel.

Close the Mel ⇄ Task loop:
- Identify the source task with \`task_search\` / \`task_get\`.
- If closure patched, updated, or created a durable mel, update the source task's \`related_mel_ids\` with \`task_update\` (read-modify-write; arrays replace).
- If multiple related mels explain the same work, add \`mel_link_create(reason="part-of" or "extracted-from-task")\` where useful.

Skip only when the mel was unrelated to the task or no durable task context should point to it.`
  );
}

function emitOperationCheckpointReminder(checkpoints) {
  const kinds = [...new Set(checkpoints.map((checkpoint) => checkpoint.kind))].join(', ');
  emitText(
    `This turn reached an operation checkpoint (${kinds}) but no Melxis task/memory update was observed after it.

Apply Memory Operating Rules:
- Treat the checkpoint as a milestone signal, not an automatic save.
- If active work maps to a Melxis task, \`task_search\` / \`task_get\` and update status or related context if appropriate.
- If the trace contains durable insight (WHY) or reusable procedure (HOW), search existing mels first. Prefer \`mel_patch\` / \`mel_update\` for refinements; use \`mel_create\` only for genuinely new memory. Link with \`extracted-from-task\` or \`part-of\` as appropriate.
- Preserve evidence status: user-reported observations need \`user-reported\` + \`needs-verification\`; hypotheses should become verification task steps, not mel facts.

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

  const hasSaveAfterLastOperationCheckpoint =
    lastOperationCheckpointIndex >= 0 &&
    hasToolCallMatchingAfterIndex(
      entries,
      /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/,
      lastOperationCheckpointIndex,
    );
  // Capture gating: only count saves that happen AFTER the most recent
  // capture anchor (latest decision / insight / preference / feedback signal
  // in user-or-assistant text). A global "any save in tail" check suppressed
  // the reminder whenever an earlier-in-session save existed, causing later
  // fresh signals to be missed.
  const lastCaptureAnchorIndex = findLastCaptureAnchorIndex(entries);
  const hasSaveAfterCaptureAnchor =
    lastCaptureAnchorIndex >= 0 &&
    hasToolCallMatchingAfterIndex(
      entries,
      /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/,
      lastCaptureAnchorIndex,
    );
  // Closure feedback gating: only count mel writes that happen AFTER the most
  // recent closure anchor (closure text signal or task_update→completed/cancelled).
  // Symmetric to capture gating above. The earlier global hasMemoryFeedback
  // check suppressed the reminder whenever any mel write existed anywhere in
  // the tail — including writes that predated the closure event — so
  // review-driven additions after a saved bug-fix mel never triggered closure
  // evaluation.
  const lastClosureAnchorIndex = findLastClosureAnchorIndex(entries);
  const hasMemoryFeedbackAfterClosure =
    lastClosureAnchorIndex >= 0 &&
    hasToolCallMatchingAfterIndex(
      entries,
      /(?:^|[._-])(mel_create|mel_update|mel_patch|mel_link_create)(?:[._-]|$)/,
      lastClosureAnchorIndex,
    );
  const hasTaskBacklinkAfterClosure =
    lastClosureAnchorIndex >= 0 &&
    hasTaskRelatedMelUpdateAfterIndex(entries, lastClosureAnchorIndex - 1);
  const taskCompleted = PATTERNS.taskCompleted.test(text);

  const captureSignals = decision.count + insight.count;
  // Dedupe quoted samples: a single line can match both decision and insight
  // patterns (e.g. "決めた... root cause was X"), and we don't want to quote
  // the same line twice.
  const captureSamples = [...new Set([...decision.samples, ...insight.samples])].slice(0, 3);

  // Capture reminder: signal-gated, no throttle. Emit if any decision /
  // insight / preference / feedback signal exists in the recent window AND
  // no save call was observed AFTER that signal.
  if (captureSignals >= 1 && !hasSaveAfterCaptureAnchor) {
    emitCaptureReminder(captureSamples);
  }

  // Closure feedback reminder: signal-gated, independent of capture.
  // A task_update(completed/cancelled) closes the task but does not by itself
  // prove that conversation/task/artifact feedback was evaluated into memory.
  // Gating uses hasMemoryFeedbackAfterClosure so that earlier in-session mel
  // writes do not suppress the reminder at closure time.
  if ((closure.count >= 1 || taskCompleted) && !hasMemoryFeedbackAfterClosure) {
    emitClosureReminder(closure.samples);
  }

  // Mel ⇄ Task ecosystem closure: a mel write after closure is only half of
  // Rule 8. The source task should point back to the durable mel so future
  // task resume can recover the rationale without relying on transcript memory.
  if (
    (closure.count >= 1 || taskCompleted) &&
    hasMemoryFeedbackAfterClosure &&
    !hasTaskBacklinkAfterClosure
  ) {
    emitEcosystemBacklinkReminder();
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
