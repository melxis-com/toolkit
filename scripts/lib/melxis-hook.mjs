// Shared helpers for Melxis hook scripts (Cut 4: stateless, Node ESM, no $HOME writes).
//
// Design:
//   - Pure stdlib (no npm dependencies). Works on any Node 18+ runtime.
//   - No filesystem writes anywhere. The harness owns transcript_path; we only read it.
//   - Defensive parsing: malformed JSONL lines are skipped, not fatal.
//   - All errors → STDERR (one line) + exit 0, so the hook never blocks the agent.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export function readStdinJson() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Defense-in-depth: only read transcript files inside the user's home
// directory. The harness contract has the transcript under ~/.claude/, but
// guarding against tampered stdin / arbitrary file read keeps the script
// honest with the README's transparency claims.
export function readTranscriptTail(path, maxLines = 200, { strict = false } = {}) {
  // Recovery checks must distinguish an unreadable log from a readable empty
  // session. Other best-effort consumers retain the existing empty fallback.
  const unreadable = () => {
    if (strict) throw new Error('Transcript unavailable or unreadable; recovery state is unknown');
    return [];
  };
  if (!path) return unreadable();
  let resolved;
  let home;
  try {
    resolved = realpathSync(resolve(path));
    home = realpathSync(homedir());
  } catch {
    return unreadable();
  }
  if (!home || (resolved !== home && !resolved.startsWith(`${home}${sep}`))) return unreadable();
  try {
    statSync(resolved);
  } catch {
    return unreadable();
  }
  let raw;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch {
    return unreadable();
  }
  const lines = raw.split('\n').filter(Boolean);
  return lines.slice(-maxLines);
}

// Parse JSONL transcript entries into objects.
// Keep raw entries and their positions. Shared readers below adapt the host's
// record shape, so callers that already have parsed entries behave identically.
export function parseTranscript(lines, { strict = false } = {}) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  if (strict && lines.length > 0 && entries.length === 0) {
    throw new Error('Transcript contains no readable records; recovery state is unknown');
  }
  return entries;
}

// Extract a flat text representation of recent conversation for grep.
// Concatenates assistant + user message text content from the tail.
//
// Tool-call inputs are intentionally excluded: their structured JSON form
// often contains save-pattern fragments (mel_create / task_update etc.)
// that match closure / decision regexes against the surrounding mel
// content rather than against actual user/assistant intent, producing
// false-positive reminders.
export function extractText(entries) {
  const parts = [];
  for (const e of entries) {
    const msg = normalizeTranscriptEntry(e)?.message;
    if (!msg) continue;
    const content = msg.content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === 'string') parts.push(c);
        else if (c?.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n');
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

// The script a shell was handed: ['/bin/zsh', '-lc', script] → script. The
// checkpoint pattern anchors at the start of the command text, so the shell
// prefix must not be part of it.
function shellScriptOf(command) {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command)) return '';
  if (command.length >= 3 && /^-[A-Za-z]*c[A-Za-z]*$/.test(String(command[1]))) return String(command[2]);
  return command.map(String).join(' ');
}

// Adapt Codex envelopes to the shapes already used by the shared readers.
// Claude records pass through unchanged. Do not traverse result payloads or
// evaluate code-mode source: nested MCP calls and shell commands have their
// own completion events. Return one view per input entry to preserve all
// boundary/checkpoint indexes.
function normalizeTranscriptEntry(value) {
  const entry = parseMaybeJson(value);
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.type === 'response_item') {
    const payload = entry.payload;
    if (payload?.type === 'message') {
      const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
      if (payload.role === 'developer' && Array.isArray(kinds) && kinds.includes('hooks.additional_context')) {
        return { type: 'hook_additional_context', content: payload.content };
      }
      if (payload.role !== 'user' && payload.role !== 'assistant') return null;
      const content = Array.isArray(payload.content)
        ? payload.content.map(c => c?.type === 'input_text' || c?.type === 'output_text'
          ? { type: 'text', text: c.text } : c)
        : payload.content;
      return { message: { role: payload.role, content } };
    }
    if (payload?.type === 'function_call' || payload?.type === 'custom_tool_call') return payload;
    return null;
  }
  if (entry.type === 'event_msg') {
    if (entry.payload?.type !== 'item_completed') return null;
    const item = entry.payload.item;
    if (item?.type === 'McpToolCall') {
      if (item.status !== 'completed' || !item.result || item.error || item.result?.isError === true) return null;
      if (typeof item.server !== 'string' || typeof item.tool !== 'string') return null;
      return { type: 'tool_use', name: `mcp__${item.server}__${item.tool}`, input: item.arguments };
    }
    if (item?.type === 'CommandExecution') {
      // Codex runs shell commands through code-mode: the `exec` call carries
      // JS source, and the command that actually ran arrives here. Codex marks
      // a non-zero exit as status 'failed', so a completed item is a command
      // that succeeded — the only kind that is a checkpoint (a rejected commit
      // or push is not one). Observed on Codex CLI 0.154.0, 2026-09-18.
      if (item.status !== 'completed' || (item.exit_code !== undefined && item.exit_code !== 0)) return null;
      const cmd = shellScriptOf(item.command);
      return cmd ? { type: 'tool_use', name: 'exec_command', input: { cmd } } : null;
    }
    return null;
  }
  return entry;
}

// Only call containers carry executable names. Arguments, tool results and
// quoted JSON are data even when they contain name/input/tool_uses fields.
// All tool-based heuristics use this reader rather than independent walkers.
function collectToolCalls(value, results = []) {
  const entry = normalizeTranscriptEntry(value);
  if (!entry || typeof entry !== 'object') return results;
  if (Array.isArray(entry)) {
    for (const item of entry) collectToolCalls(item, results);
    return results;
  }
  if (entry.message) {
    if (!entry.message.role || entry.message.role === 'assistant') {
      // Strings in messages are prose, never serialized calls.
      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block && typeof block === 'object') collectToolCalls(block, results);
        }
      }
    }
    return results;
  }
  const callType = ['tool_use', 'function_call', 'custom_tool_call'].includes(entry.type);
  if (entry.type && !callType) return results;
  const name = entry.name ?? entry.tool_name ?? entry.recipient_name ?? entry.function?.name;
  const input = parseMaybeJson(entry.input ?? entry.arguments ?? entry.parameters ?? entry.function?.arguments);
  if (typeof name === 'string' && (callType || input !== undefined)) {
    results.push({ name, input });
    // Legacy multi-tool containers explicitly list calls; other tool inputs
    // must not be searched recursively for things that resemble calls.
    if (/^multi_tool_use[._]/.test(name) && Array.isArray(input?.tool_uses)) {
      collectToolCalls(input.tool_uses, results);
    }
  } else if (Array.isArray(entry.tool_uses)) {
    collectToolCalls(entry.tool_uses, results);
  }
  return results;
}

function isCommandToolName(value) {
  return /(^|[._-])(bash|exec_command|shell|terminal)([._-]|$)/i.test(String(value ?? ''));
}

function collectCommandToolInputs(value, results = []) {
  for (const { name, input } of collectToolCalls(value)) {
    if (isCommandToolName(name)) {
      const cmd = input?.cmd ?? input?.command;
      if (typeof cmd === 'string' && cmd.trim()) results.push(cmd);
    }
  }
  return results;
}

export function hasToolCallMatching(entries, pattern) {
  return collectToolCalls(entries).some(({ name }) => pattern.test(name));
}

export function hasToolCallMatchingAfterIndex(entries, pattern, index) {
  const start = Math.max(0, index + 1);
  return hasToolCallMatching(entries.slice(start), pattern);
}

// Scan adapted entries for a marker while keeping original entry indexes.
// hookOnly requires a real hook record, not a quote inside text or tool data.

export function findLastEntryIndexMatching(entries, pattern, options = {}) {
  if (!Array.isArray(entries)) return -1;
  const hookOnly = options.hookOnly === true;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = normalizeTranscriptEntry(entries[i]);
    let raw;
    if (entry && typeof entry === 'object') {
      if (hookOnly && !(typeof entry.type === 'string' && entry.type.startsWith('hook_'))) {
        continue;
      }
      try {
        raw = JSON.stringify(entry);
      } catch {
        continue;
      }
    } else if (typeof entry === 'string') {
      if (hookOnly) continue;
      raw = entry;
    } else {
      continue;
    }
    if (raw && pattern.test(raw)) return i;
  }
  return -1;
}

// How many entries after `index` match `pattern`. Shares the scan rules of
// findLastEntryIndexMatching (including hookOnly) so a caller can budget how
// often the same reminder has already fired within a window.
export function countEntriesMatchingAfterIndex(entries, pattern, index, options = {}) {
  if (!Array.isArray(entries)) return 0;
  const start = Math.max(0, index + 1);
  let count = 0;
  for (let i = start; i < entries.length; i++) {
    const slice = entries.slice(i, i + 1);
    if (findLastEntryIndexMatching(slice, pattern, options) === 0) count++;
  }
  return count;
}

// Any Melxis task write counts as "progress reflected": task_update, but also
// task_patch (the tool the product itself steers agents toward for localized
// description edits) and task_create (anchoring new work IS reflecting it).
// Counting only task_update made compliant patch-first sessions look
// non-compliant, so the reminder fired right after the progress had been
// written (observed dogfood 2026-07-30). task_note counts too: a finding,
// question or blocker appended to the timeline is progress reflected in
// Melxis, and the reminder that follows would ask for exactly that write.
// A note-only session can leave the description stale; that is recovered on
// the next resume path, where every SessionStart block reads the timeline
// first and then refreshes the compressed current state.
export function hasTaskWriteAfterIndex(entries, index) {
  if (!Array.isArray(entries)) return false;
  const start = Math.max(0, index + 1);
  return hasToolCallMatching(
    entries.slice(start),
    /(?:^|[._-])task_(?:update|patch|create|note)(?:[._-]|$)/,
  );
}

// Session boundary marker text, as emitted by the SessionStart hook blocks.
// Canonical here so the turn walk below and the boundary/nag anchoring in
// on_user_prompt_submit.mjs test the same set of block titles.
export const SESSION_BOUNDARY_TEXT_RE =
  /Melxis Session (?:Bootstrap|Resumed|Hook)|Melxis Post-Compaction Recovery/;

// A turn starts at the user's prompt: the assistant prose, tool calls, and
// tool results that follow all belong to one reply. Within a turn the task
// write usually lands BEFORE the closing progress prose, so comparing writes
// against the progress entry's index misreads every well-behaved turn as
// "progress without a write". Callers compare against the turn start instead.
// A prompt entry is user-role text without tool_result blocks (tool results
// are also recorded under the user role); hook emissions are skipped. Returns
// `index` itself when no prompt boundary is inside the window (fall back to
// entry-order comparison).
export function findTurnStartIndex(entries, index) {
  if (!Array.isArray(entries) || index < 0) return index;
  for (let i = Math.min(index, entries.length - 1); i >= 0; i--) {
    const entry = normalizeTranscriptEntry(entries[i]);
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.type === 'string' && entry.type.startsWith('hook_')) {
      // A session boundary (startup / resume / compaction block) ends the
      // walk: without this stop, a window whose prompt entry sits before the
      // boundary would resolve the "turn" into the previous session, and a
      // stale task write there would suppress a genuinely unreflected turn.
      let raw;
      try {
        raw = JSON.stringify(entry);
      } catch {
        continue;
      }
      if (raw && SESSION_BOUNDARY_TEXT_RE.test(raw)) return i;
      continue;
    }
    const msg = entry.message;
    if (!msg || msg.role !== 'user') continue;
    const content = msg.content;
    if (typeof content === 'string') return i;
    if (Array.isArray(content)) {
      const hasToolResult = content.some(
        (c) => c && typeof c === 'object' && c.type === 'tool_result',
      );
      const hasText = content.some(
        (c) => typeof c === 'string' || (c && typeof c === 'object' && c.type === 'text'),
      );
      if (hasText && !hasToolResult) return i;
    }
  }
  return index;
}

// Check whether a single transcript entry's message text matches a pattern.
// Mirrors extractText's content-walking but scoped to one entry so we can
// pinpoint the position of the latest matching signal.
function entryTextMatchesPattern(entry, pattern) {
  const msg = normalizeTranscriptEntry(entry)?.message;
  if (!msg) return false;
  const content = msg.content;
  if (typeof content === 'string') return pattern.test(content);
  if (Array.isArray(content)) {
    for (const c of content) {
      if (typeof c === 'string' && pattern.test(c)) return true;
      if (c && typeof c === 'object' && typeof c.text === 'string' && pattern.test(c.text)) {
        return true;
      }
    }
  }
  return false;
}

// Locate the most recent transcript entry that anchors a capture event —
// any decision, insight, preference, or feedback signal in user/assistant text.
// Used to scope "did the agent save after the latest capture signal?" so that
// an earlier-in-session save does not suppress the reminder when a fresh
// signal arrives.
export function findLastCaptureAnchorIndex(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (
      entryTextMatchesPattern(entry, PATTERNS.decision) ||
      entryTextMatchesPattern(entry, PATTERNS.insight)
    ) {
      return i;
    }
  }
  return -1;
}

const GIT_CHECKPOINT_PATTERN = new RegExp(
  [
    '(^|[;&|]\\s*)',
    '(?:env\\s+(?:[A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*)?',
    '(?:(?:command|noglob)\\s+)?',
    '(?:[\\w./-]*/)?git\\s+',
    '(?:(?:-[A-Za-z]|--[A-Za-z0-9-]+)(?:[=\\s]\\S+)?\\s+)*',
    '(commit|push)\\b',
  ].join(''),
  'i',
);

export function extractOperationCheckpoints(entries) {
  const checkpoints = [];
  for (const [entryIndex, entry] of entries.entries()) {
    const commands = collectCommandToolInputs(entry);
    for (const command of commands) {
      const match = command.match(GIT_CHECKPOINT_PATTERN);
      if (match) {
        checkpoints.push({
          kind: `git ${match[2].toLowerCase()}`,
          command,
          entryIndex,
        });
      }
    }
  }
  return checkpoints;
}

export function hasTaskLikeContext(entries) {
  if (!Array.isArray(entries)) return false;
  if (hasActiveMelxisTask(entries)) return true;
  if (
    hasToolCallMatching(
      entries,
      // task_patch included: a session editing a task description is task
      // context as much as one updating it (same omission as the write
      // matcher, observed dogfood 2026-07-30).
      /(?:^|[._-])(?:task_search|task_get|task_create|task_update|task_patch|task_note)(?:[._-]|$)/,
    )
  ) {
    return true;
  }
  const text = extractText(entries);
  return /\b(task|plan|todo|checkpoint|milestone|implementation|fix|bug|review|refactor|investigation)\b|タスク|計画|実装|修正|調査|レビュー|リファクタ/i.test(
    text,
  );
}

const SUBSTANTIAL_PROGRESS_PATTERN =
  /\b(implemented|fixed|changed|updated|added|removed|committed|pushed|tested|verified|completed|finished|done)\b|実装した|修正した|変更した|追加した|削除した|コミット|プッシュ|テスト|確認した|完了/i;

export function findLastSubstantialProgressIndex(entries) {
  if (!Array.isArray(entries)) return -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entryTextMatchesPattern(entries[i], SUBSTANTIAL_PROGRESS_PATTERN)) return i;
  }
  return -1;
}

// Detect whether the recent transcript shows an active Melxis task. An
// "active" task is one that has been created (via task_create) or transitioned
// to in_progress (via task_update) without a subsequent closure transition
// (completed / cancelled) on the same task id. The latter scoping is
// approximate: we walk entries in order, set "active" on create/in_progress,
// and clear "active" on completed/cancelled regardless of id, because the
// UserPromptSubmit caller only needs a yes/no signal that some task anchor
// is in play before injecting the task_create directive. False positives
// (an active task suppresses the directive) are preferable to false
// negatives (re-injecting the directive over an already-anchored loop).
export function hasActiveMelxisTask(entries) {
  if (!Array.isArray(entries)) return false;
  let active = false;
  // Walk entries in order via a queue; we want chronological transitions so
  // that a later completed/cancelled clears an earlier in_progress.
  for (const entry of entries) {
    const found = findTaskTransitions(entry);
    for (const t of found) {
      if (t === 'open') active = true;
      else if (t === 'close') active = false;
    }
  }
  return active;
}

// Return a list of 'open' | 'close' transitions discovered inside a single
// transcript entry. 'open' covers task_create and a status=in_progress on
// task_update / task_patch. 'close' covers status completed/cancelled on
// either write tool — the transition is the signal, not the tool name
// (task_patch carries an optional status). Order within an entry is
// best-effort (object key iteration order) but multi-transition single
// entries are rare in practice.
function findTaskTransitions(entry) {
  const out = [];
  for (const { name, input } of collectToolCalls(entry)) {
    const isCreate = /(?:^|[._-])task_create(?:[._-]|$)/.test(name);
    const isStatusWrite = /(?:^|[._-])task_(?:update|patch)(?:[._-]|$)/.test(name);
    if (isCreate || isStatusWrite) {
      const status = input && typeof input === 'object' ? input.status : undefined;
      if (isCreate) {
        // task_create may omit status (defaults to in_progress per Melxis convention)
        if (status === undefined || status === 'in_progress') out.push('open');
        else if (status === 'completed' || status === 'cancelled') out.push('close');
      } else if (isStatusWrite) {
        if (status === 'in_progress') out.push('open');
        else if (status === 'completed' || status === 'cancelled') out.push('close');
      }
    }
  }
  return out;
}

// Multilingual signal patterns. Aligns with the v0.8 bash impl so behavior
// stays comparable across the migration. All patterns are non-global so
// `pattern.test(line)` inside a loop never carries lastIndex state.
export const PATTERNS = {
  // decision pattern covers positive intent signals: decisions, confirmations,
  // and forward-looking preferences ("I prefer X", "yes exactly", and the
  // Japanese equivalents the pattern below also matches).
  // These are easy to miss at the agent layer and worth capturing as mels.
  decision:
    /(decided to|chose to|will use|migrating to|switching to|採用した|決めた|決定した|確定|変更した|let's go with|we'll use|settled on|yes exactly|perfect|今後は|I prefer|please always)/i,
  // insight pattern covers root-cause analysis and corrective feedback
  // ("stop doing X", "no not that", and its Japanese equivalent) — both
  // reshape future behavior.
  insight:
    /(root cause|caused by|was caused|原因は|原因が判明|the bug was|refactor(ed|ing)|リファクタ|stop doing|no not that|やめて)/i,
  closure: /(shipped|pushed|landed|merged|done with|完了|できた|終わった|finished|ship it)/i,
  save: /(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)/,
};

export function emitText(text) {
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');
}

export function logError(label, err) {
  // One-line STDERR. The harness surfaces this in transcript metadata for
  // debugging without polluting the agent's prompt context.
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`melxis-hook[${label}]: ${msg}\n`);
}
