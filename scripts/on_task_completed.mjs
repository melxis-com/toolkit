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

Read the task's \`timeline\` via \`task_get\` first — it is the trace to extract from (re-read with \`timeline_limit\` if \`timeline_truncated\`; 200 is the ceiling, so still truncated there means the oldest entries are out of reach — say the trace was partial). Then evaluate closure feedback from it, the conversation log, tool activity, and related mels. Extract from it, do not copy it: one mel per insight, in its own words — never a digest of the entries or a note copied over.

1. Existing memory to refine? Prefer \`mel_patch\` / \`mel_update\` when this corrects or sharpens an existing mel.
2. New durable insight? Use \`mel_create\` only when the feedback is genuinely new (design-decision / bug-fix / anti-pattern).
3. New reusable procedure? Use \`mel_create\` with tag \`convention\` only when it will recur across sessions.
4. Relationship update? Use \`mel_link_create\` with reason "extracted-from-task" to connect a task-derived memory to the task's related mels it actually bears on — skip any link you cannot justify in a sentence (links connect mels; the task itself is anchored through step 5).
5. Task anchor? Consider adding relevant mel IDs back to the source task via \`task_update\` (read-modify-write; arrays replace).
6. Granularity lesson? Capture only when the completed work contained multiple independently resumable intentions, different owners/surfaces, or separate completion criteria.
7. Question or blocker left open in the timeline? Carry it into a sub-task or a verification task — it is not a mel. A raised entry with no note closing it is still open; silence does not mean resolved.

Search before writing when an existing mel may already cover the point. Skip if the completed work was trivial or no reusable feedback exists.

Write behavior follows the active \`MELXIS_WRITE_POLICY\` (default \`auto\`).`
  );
} catch (err) {
  logError('task-completed', err);
}

process.exit(0);
