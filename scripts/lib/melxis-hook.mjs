// Shared helpers for Melxis hook scripts (Cut 4: stateless, Node ESM, no $HOME writes).
//
// Design:
//   - Pure stdlib (no npm dependencies). Works on any Node 18+ runtime.
//   - No filesystem writes anywhere. The harness owns transcript_path; we only read it.
//   - Defensive parsing: malformed JSONL lines are skipped, not fatal.
//   - All errors → STDERR (one line) + exit 0, so the hook never blocks the agent.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
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
export function readTranscriptTail(path, maxLines = 200) {
  if (!path) return [];
  const resolved = resolve(path);
  const home = homedir();
  if (!home || !resolved.startsWith(home)) return [];
  try {
    statSync(resolved);
  } catch {
    return [];
  }
  let raw;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  return lines.slice(-maxLines);
}

// Parse JSONL transcript entries into objects.
// Each entry has shape { type, message: { role, content }, ... } per Claude Code's
// transcript format. Defensive: silently skip lines that don't parse.
export function parseTranscript(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
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
    const msg = e?.message;
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

function isCommandToolName(value) {
  return /(^|[._-])(bash|exec_command|shell|terminal)([._-]|$)/i.test(String(value ?? ''));
}

function collectCommandToolInputs(value, results = []) {
  if (!value || typeof value !== 'object') return results;

  if (Array.isArray(value)) {
    for (const item of value) collectCommandToolInputs(item, results);
    return results;
  }

  const name = value.name ?? value.tool_name ?? value.recipient_name ?? value.function?.name;
  const isCommandTool = isCommandToolName(name);
  const input = parseMaybeJson(
    value.input ?? value.arguments ?? value.parameters ?? value.function?.arguments,
  );

  if (isCommandTool) {
    const cmd = input?.cmd ?? input?.command ?? value.cmd ?? value.command;
    if (typeof cmd === 'string' && cmd.trim()) {
      results.push(cmd);
    }
  }

  // multi_tool_use nests individual calls under `tool_uses`; Claude/Codex
  // transcripts may also nest function calls inside content arrays.
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectCommandToolInputs(parseMaybeJson(child), results);
  }

  return results;
}

export function hasToolCallMatching(entries, pattern) {
  const stack = Array.isArray(entries) ? [...entries] : [entries];
  while (stack.length) {
    const current = parseMaybeJson(stack.pop());
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    const names = [
      current.name,
      current.tool_name,
      current.recipient_name,
      current.function?.name,
    ].filter(Boolean);
    if (names.some((name) => pattern.test(String(name)))) return true;

    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') stack.push(child);
      else if (typeof child === 'string' && child.trim().startsWith('{')) stack.push(child);
    }
  }
  return false;
}

export function hasToolCallMatchingAfterIndex(entries, pattern, index) {
  const start = Math.max(0, index + 1);
  return hasToolCallMatching(entries.slice(start), pattern);
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

// Multilingual signal patterns. Aligns with the v0.8 bash impl so behavior
// stays comparable across the migration. All patterns are non-global so
// `pattern.test(line)` inside a loop never carries lastIndex state.
export const PATTERNS = {
  decision: /(decided to|chose to|will use|migrating to|switching to|採用した|決めた|決定した|確定|変更した|let's go with|we'll use|settled on)/i,
  insight: /(root cause|caused by|was caused|原因は|原因が判明|the bug was|refactor(ed|ing)|リファクタ)/i,
  closure: /(shipped|pushed|landed|merged|done with|完了|できた|終わった|finished|ship it)/i,
  save: /(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)/,
  taskCompleted: /task_update[^"]*"status"[^"]*"(completed|cancelled)"/,
};

// Strip markdown / instruction-framing characters from a transcript excerpt
// before quoting it back into the agent's prompt. Without this, an attacker
// who plants "## New instructions" in mel content (which the agent later
// echoes) could craft a line that appears in the hook's blockquote with
// active markdown structure that some clients render as headings or code.
function sanitizeQuotedLine(line) {
  return line.replace(/[`*#<>]/g, '');
}

// Count and capture matched lines from text.
// Returns { count, samples }: samples are at most maxSamples lines, each
// truncated to 200 chars, sanitized of markdown framing, and prefixed
// with "  > " for blockquote feel.
export function captureMatches(text, pattern, maxSamples = 3) {
  const lines = text.split('\n');
  const matched = [];
  let count = 0;
  for (const line of lines) {
    if (pattern.test(line)) {
      count += 1;
      if (matched.length < maxSamples) {
        const trimmed = sanitizeQuotedLine(line.replace(/^\s+/, '').slice(0, 200));
        matched.push(`  > ${trimmed}`);
      }
    }
  }
  return { count, samples: matched };
}

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
