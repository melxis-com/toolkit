import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  extractOperationCheckpoints,
  countEntriesMatchingAfterIndex,
  findLastCaptureAnchorIndex,
  findLastSubstantialProgressIndex,
  hasTaskLikeContext,
  hasActiveMelxisTask,
  hasTaskWriteAfterIndex,
  findTurnStartIndex,
  hasToolCallMatchingAfterIndex,
  PATTERNS,
  readTranscriptTail,
} from './melxis-hook.mjs';

const MELXIS_WRITE_TOOL =
  /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/;
const MEL_WRITE_TOOL =
  /(?:^|[._-])(mel_create|mel_update|mel_patch|mel_link_create)(?:[._-]|$)/;

function textEntry(role, text) {
  return { message: { role, content: text } };
}

function toolUseEntry(name, input) {
  return { message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } };
}

// Tool results are recorded under the user role in Claude Code transcripts —
// findTurnStartIndex must not mistake them for the prompt that opened the turn.
function toolResultEntry(text) {
  return { message: { role: 'user', content: [{ type: 'tool_result', content: text }] } };
}

test('operation checkpoints keep transcript order for post-checkpoint save gating', () => {
  const entries = [
    {
      name: 'mcp__melxis__.task_update',
      input: { id: 'previous-task' },
    },
    {
      name: 'functions.exec_command',
      input: { cmd: 'git push' },
    },
  ];

  const [checkpoint] = extractOperationCheckpoints(entries);

  assert.equal(checkpoint.kind, 'git push');
  assert.equal(checkpoint.entryIndex, 1);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MELXIS_WRITE_TOOL, checkpoint.entryIndex), false);
});

test('post-checkpoint Melxis writes suppress operation checkpoint reminder', () => {
  const entries = [
    {
      name: 'functions.exec_command',
      input: { cmd: 'git commit -m "Update copy"' },
    },
    {
      name: 'mcp__melxis__.task_update',
      input: { id: 'completed-task' },
    },
  ];

  const [checkpoint] = extractOperationCheckpoints(entries);

  assert.equal(checkpoint.kind, 'git commit');
  assert.equal(checkpoint.entryIndex, 0);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MELXIS_WRITE_TOOL, checkpoint.entryIndex), true);
});

test('on_stop stays non-blocking and silent for Melxis heuristic checkpoints', () => {
  const child = spawnSync(process.execPath, ['scripts/on_stop.mjs'], {
    cwd: new URL('../..', import.meta.url),
    input: JSON.stringify({ transcript_path: '' }),
    encoding: 'utf8',
  });

  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout, '');
});

test('readTranscriptTail rejects symlinked transcript paths outside home', () => {
  const localDir = mkdtempSync(resolve(process.cwd(), '.tmp-melxis-hook-test-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'melxis-hook-test-'));
  try {
    const outsideTranscript = join(outsideDir, 'transcript.jsonl');
    const linkPath = join(localDir, 'transcript-link.jsonl');
    writeFileSync(outsideTranscript, '{"message":{"content":"secret"}}\n');
    symlinkSync(outsideTranscript, linkPath);

    assert.deepEqual(readTranscriptTail(linkPath), []);
  } finally {
    rmSync(localDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('readTranscriptTail reads regular transcript paths under home', () => {
  const localDir = mkdtempSync(resolve(process.cwd(), '.tmp-melxis-hook-test-'));
  try {
    const transcript = join(localDir, 'transcript.jsonl');
    writeFileSync(transcript, '{"line":1}\n{"line":2}\n');

    assert.deepEqual(readTranscriptTail(transcript, 1), ['{"line":2}']);
  } finally {
    rmSync(localDir, { recursive: true, force: true });
  }
});

test('hasTaskWriteAfterIndex only counts task writes after the checkpoint', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' }),
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "hook behavior"' }),
  ];

  assert.equal(hasTaskWriteAfterIndex(entries, 1), false);
  assert.equal(hasTaskWriteAfterIndex(entries, 0), false);
  assert.equal(hasTaskWriteAfterIndex(entries, -1), true);
});

test('hasTaskWriteAfterIndex counts task_patch and task_create, not task reads', () => {
  // The product steers agents toward task_patch for localized description
  // edits; counting only task_update made compliant sessions look
  // non-compliant and the reminder fired right after the write.
  assert.equal(
    hasTaskWriteAfterIndex([toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1' })], -1),
    true,
  );
  assert.equal(
    hasTaskWriteAfterIndex([toolUseEntry('mcp__melxis__.task_create', { title: 'anchor' })], -1),
    true,
  );
  assert.equal(
    hasTaskWriteAfterIndex([toolUseEntry('mcp__melxis__.task_get', { id: 't1' })], -1),
    false,
  );
  assert.equal(
    hasTaskWriteAfterIndex([toolUseEntry('mcp__melxis__.task_search', { query: 'x' })], -1),
    false,
  );
});

test('findTurnStartIndex walks back to the user prompt that opened the turn', () => {
  const entries = [
    textEntry('user', 'please fix the reminder'),
    toolUseEntry('mcp__melxis__.task_patch', { id: 't1' }),
    toolResultEntry('{"id":"t1"}'),
    textEntry('assistant', 'fixed the matcher and updated the task'),
  ];

  // The closing prose (index 3) belongs to the turn opened at index 0.
  assert.equal(findTurnStartIndex(entries, 3), 0);
  // tool_result entries carry the user role but are not prompts.
  assert.equal(findTurnStartIndex(entries, 2), 0);
  // No prompt boundary in the window: fall back to the given index.
  assert.equal(findTurnStartIndex(entries.slice(1), 2), 2);
});

test('findTurnStartIndex stops at a session boundary instead of walking into the previous session', () => {
  // A stale task write before the boundary must not count as reflecting
  // progress made after it (review 2026-07-30).
  const entries = [
    textEntry('user', 'previous session prompt'),
    toolUseEntry('mcp__melxis__.task_patch', { id: 't1' }),
    { type: 'hook_success', message: { role: 'user', content: 'Melxis Session Resumed' } },
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "step"' }),
    textEntry('assistant', 'implemented the step and committed it'),
  ];

  // The walk from the post-boundary prose stops at the boundary (index 2),
  // not at the pre-boundary prompt (index 0).
  assert.equal(findTurnStartIndex(entries, 4), 2);
});

test('task lifecycle transitions count a status carried by task_patch (closure rides either tool)', () => {
  // task_patch accepts an optional status; closing through it must clear the
  // active-task state exactly like task_update(status=completed).
  const opened = [toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' })];
  assert.equal(hasActiveMelxisTask(opened), true);

  const closedByPatch = [
    ...opened,
    toolUseEntry('mcp__plugin_melxis_melxis__task_patch', {
      id: 't1',
      old_text: 'Next: ship',
      new_text: 'Outcome: shipped',
      status: 'completed',
    }),
  ];
  assert.equal(hasActiveMelxisTask(closedByPatch), false);

  // A plain task_patch without status is not a lifecycle transition.
  const patchedOnly = [
    ...opened,
    toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1', old_text: 'a', new_text: 'b' }),
  ];
  assert.equal(hasActiveMelxisTask(patchedOnly), true);
});

test('hasTaskLikeContext counts task_patch as task context', () => {
  assert.equal(
    hasTaskLikeContext([toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1' })]),
    true,
  );
});

test('task-like context can come from an active Melxis task or task wording', () => {
  assert.equal(hasTaskLikeContext([toolUseEntry('mcp__melxis__.task_create', { name: 'hooks' })]), true);
  assert.equal(hasTaskLikeContext([textEntry('user', 'please review this implementation')]), true);
  assert.equal(hasTaskLikeContext([textEntry('user', 'what is the weather')]), false);
});

// --- PATTERNS coverage for preference / correction signals ----------------

test('PATTERNS.decision matches preference signals', () => {
  assert.match('I prefer the explicit form here', PATTERNS.decision);
  assert.match('今後は別の手で進めて', PATTERNS.decision);
  assert.match('please always lowercase tags', PATTERNS.decision);
  assert.match('yes exactly what I meant', PATTERNS.decision);
});

test('PATTERNS.insight matches correction signals', () => {
  assert.match('stop doing that please', PATTERNS.insight);
  assert.match('no not that one', PATTERNS.insight);
  assert.match('やめてほしい', PATTERNS.insight);
});

// --- findLastCaptureAnchorIndex (symmetric to closure) --------------------

test('findLastCaptureAnchorIndex returns -1 when no decision or insight signal exists', () => {
  const entries = [textEntry('user', 'hi'), textEntry('assistant', 'hello')];
  assert.equal(findLastCaptureAnchorIndex(entries), -1);
});

test('findLastCaptureAnchorIndex detects a preference signal in user text', () => {
  const entries = [
    textEntry('assistant', 'starting work'),
    textEntry('user', '今後はこのスタイルで'),
  ];
  assert.equal(findLastCaptureAnchorIndex(entries), 1);
});

test('findLastCaptureAnchorIndex detects a correction signal', () => {
  const entries = [
    textEntry('assistant', 'first attempt'),
    textEntry('user', 'no not that — use the other path'),
  ];
  assert.equal(findLastCaptureAnchorIndex(entries), 1);
});

test('findLastCaptureAnchorIndex returns latest of multiple signals', () => {
  const entries = [
    textEntry('user', '採用した方針で進めて'),
    textEntry('assistant', 'ok'),
    textEntry('user', 'やめてその実装は'),
  ];
  assert.equal(findLastCaptureAnchorIndex(entries), 2);
});

test('capture gating: save before signal does not suppress reminder', () => {
  // This is the symmetric bug-fix scenario: early-in-session save existed,
  // then a fresh decision/preference appeared. Reminder must fire because the
  // new signal has no save AFTER it.
  const entries = [
    toolUseEntry('mcp__melxis__.mel_create', { name: 'earlier-bug-fix' }),
    textEntry('user', 'unrelated chatter'),
    textEntry('user', '今後はこの方針で確定'),
  ];
  const anchor = findLastCaptureAnchorIndex(entries);
  assert.equal(anchor, 2);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MELXIS_WRITE_TOOL, anchor), false);
});

test('capture gating: save after signal suppresses reminder', () => {
  const entries = [
    textEntry('user', '採用した方針で'),
    toolUseEntry('mcp__melxis__.mel_create', { name: 'captured-decision' }),
  ];
  const anchor = findLastCaptureAnchorIndex(entries);
  assert.equal(anchor, 0);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MELXIS_WRITE_TOOL, anchor), true);
});

// --- countEntriesMatchingAfterIndex ---------------------------------------
//
// Source of the nag budget count. Its edge cases (index=-1, empty array, an
// index at the end, a non-array) were only ever exercised through the caller's
// integration tests, so a broken contract stayed invisible as long as the
// expectations in on_user_prompt_submit happened to still line up.

const RE = /needle/;
const hookEntry = (text) => ({ type: 'hook_success', content: [text] });

test('countEntriesMatchingAfterIndex: index=-1 scans every entry', () => {
  const entries = [hookEntry('needle a'), hookEntry('other'), hookEntry('needle b')];
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, -1, { hookOnly: true }), 2);
});

test('countEntriesMatchingAfterIndex: entries at or before the index are not counted', () => {
  const entries = [hookEntry('needle a'), hookEntry('needle b'), hookEntry('needle c')];
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, 0, { hookOnly: true }), 2);
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, 1, { hookOnly: true }), 1);
});

test('countEntriesMatchingAfterIndex: a trailing or out-of-range index yields 0', () => {
  const entries = [hookEntry('needle a'), hookEntry('needle b')];
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, entries.length - 1, { hookOnly: true }), 0);
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, 99, { hookOnly: true }), 0);
});

test('countEntriesMatchingAfterIndex: empty and non-array inputs yield 0 without throwing', () => {
  assert.equal(countEntriesMatchingAfterIndex([], RE, -1), 0);
  assert.equal(countEntriesMatchingAfterIndex(null, RE, -1), 0);
  assert.equal(countEntriesMatchingAfterIndex(undefined, RE, -1), 0);
  assert.equal(countEntriesMatchingAfterIndex('not an array', RE, -1), 0);
});

test('countEntriesMatchingAfterIndex: hookOnly counts hook-emitted entries only', () => {
  const entries = [
    hookEntry('needle in a hook'),
    { message: { role: 'assistant', content: 'needle in assistant prose' } },
  ];
  assert.equal(countEntriesMatchingAfterIndex(entries, RE, -1, { hookOnly: true }), 1);
});

// findLastSubstantialProgressIndex is live: on_user_prompt_submit.mjs uses it to
// compute armIndex. Dropping the boolean variant hasSubstantialProgressSignal as
// dead code also took out the coverage for this function, which shared the same
// test block — restore it on its own.
test('findLastSubstantialProgressIndex: returns the latest index carrying progress text', () => {
  const entries = [
    textEntry('assistant', 'starting'),
    textEntry('assistant', 'implemented the hook behavior and tested it'),
  ];
  assert.equal(findLastSubstantialProgressIndex(entries), 1);
});

test('findLastSubstantialProgressIndex: returns -1 when there is no progress', () => {
  assert.equal(findLastSubstantialProgressIndex([textEntry('assistant', 'starting')]), -1);
});
