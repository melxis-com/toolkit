import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOperationCheckpoints,
  findLastCaptureAnchorIndex,
  findLastClosureAnchorIndex,
  hasToolCallMatchingAfterIndex,
  PATTERNS,
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

// --- findLastClosureAnchorIndex -------------------------------------------

test('findLastClosureAnchorIndex returns -1 when no closure signal exists', () => {
  const entries = [textEntry('user', 'how are you'), textEntry('assistant', 'fine')];
  assert.equal(findLastClosureAnchorIndex(entries), -1);
});

test('findLastClosureAnchorIndex picks up closure text in assistant message', () => {
  const entries = [
    textEntry('user', 'please ship it'),
    textEntry('assistant', 'commit + push 完了しました'),
  ];
  assert.equal(findLastClosureAnchorIndex(entries), 1);
});

test('findLastClosureAnchorIndex detects task_update tool call with completed status', () => {
  const entries = [
    textEntry('assistant', 'starting work'),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
  ];
  assert.equal(findLastClosureAnchorIndex(entries), 1);
});

test('findLastClosureAnchorIndex ignores task_update without closure status', () => {
  const entries = [toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' })];
  assert.equal(findLastClosureAnchorIndex(entries), -1);
});

test('findLastClosureAnchorIndex returns latest of multiple closure signals', () => {
  const entries = [
    textEntry('assistant', 'finished part one'),
    textEntry('assistant', 'unrelated'),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
  ];
  assert.equal(findLastClosureAnchorIndex(entries), 2);
});

test('closure gating: mel write before closure does not suppress reminder', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.mel_create', { name: 'bug-fix' }),
    textEntry('assistant', 'extensive review-driven additions'),
    textEntry('assistant', 'commit + push 完了'),
  ];
  const anchor = findLastClosureAnchorIndex(entries);
  assert.equal(anchor, 2);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MEL_WRITE_TOOL, anchor), false);
});

test('closure gating: mel write after closure suppresses reminder', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
    toolUseEntry('mcp__melxis__.mel_create', { name: 'extracted insight' }),
  ];
  const anchor = findLastClosureAnchorIndex(entries);
  assert.equal(anchor, 0);
  assert.equal(hasToolCallMatchingAfterIndex(entries, MEL_WRITE_TOOL, anchor), true);
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
