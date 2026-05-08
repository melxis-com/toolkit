#!/usr/bin/env node
// Hook: TaskCompleted
//
// Fires when a task is marked completed. Prompts closure feedback evaluation
// from the conversation/task/artifact trace into Melxis memory. Pure prompt
// injection.
//
// Cut 4: Node ESM, no jq, stateless. Sanitization preserved (strip CR/LF,
// cap length) to neutralize prompt injection via task_subject.
import { readStdinJson, emitText, logError } from './lib/melxis-hook.mjs';

// Sanitization neutralizes prompt injection via task_subject. Strip the full
// set of Unicode line separators (LS U+2028 / PS U+2029 are treated as line
// breaks by some Markdown renderers and tokenizers, so naive \r\n stripping
// leaks), markdown structural characters that could re-frame the surrounding
// prompt, and double-quotes that can break out of the quoted display block.
const LINE_BREAK_RE = new RegExp('[\\r\\n\\u2028\\u2029]', 'g');
const MARKDOWN_FRAME_RE = /[`*#"<>]/g;

function sanitize(value) {
  return String(value ?? 'completed task')
    .replace(LINE_BREAK_RE, ' ')
    .replace(MARKDOWN_FRAME_RE, '')
    .slice(0, 200);
}

try {
  const input = readStdinJson();
  const subject = sanitize(input.task_subject);

  emitText(
    `Task completed: "${subject}"

Evaluate closure feedback from the conversation log, task trace, tool activity, and related mels:

1. Existing memory to refine? Prefer \`mel_patch\` / \`mel_update\` when this corrects or sharpens an existing mel.
2. New durable insight? Use \`mel_create\` only when the feedback is genuinely new (design-decision / bug-fix / anti-pattern).
3. New reusable procedure? Use \`mel_create\` with tag \`convention\` only when it will recur across sessions.
4. Relationship update? Use \`mel_link_create\` with reason "extracted-from-task" where a task-derived memory should connect to related mels.
5. Task anchor? Consider adding relevant mel IDs back to the source task via \`task_update\` (read-modify-write; arrays replace).
6. Granularity lesson? Capture only when the completed work contained multiple independently resumable intentions, different owners/surfaces, or separate completion criteria.

Search before writing when an existing mel may already cover the point. Skip if the completed work was trivial or no reusable feedback exists.

Write behavior follows the active \`MELXIS_WRITE_POLICY\` (default \`auto\`).`
  );
} catch (err) {
  logError('task-completed', err);
}

process.exit(0);
