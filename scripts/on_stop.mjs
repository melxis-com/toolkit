#!/usr/bin/env node
// Hook: Stop
//
// Fires when the assistant finishes responding. It evaluates the transcript
// tail but never blocks for Melxis heuristic checkpointing: Claude Code renders
// Stop blocks as user-visible "Stop hook error", which conflicts with routine
// Melxis bookkeeping staying silent. Next-turn recovery happens in
// on_user_prompt_submit.mjs.
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
  logError,
} from './lib/melxis-hook.mjs';

try {
  const input = readStdinJson();
  if (input.stop_hook_active) {
    process.exit(0);
  }

  const lines = readTranscriptTail(input.transcript_path, 200);
  if (!lines.length) {
    process.exit(0);
  }
} catch (err) {
  logError('stop', err);
}

process.exit(0);
