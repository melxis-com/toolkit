import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  extractOperationCheckpoints,
  findLastCaptureAnchorIndex,
  findLastClosureAnchorIndex,
  findLastSubstantialProgressIndex,
  hasSubstantialProgressSignal,
  hasTaskLikeContext,
  hasTaskRelatedMelUpdateAfterIndex,
  hasTaskUpdateAfterIndex,
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

test('hasTaskUpdateAfterIndex only counts task updates after the checkpoint', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' }),
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "hook behavior"' }),
  ];

  assert.equal(hasTaskUpdateAfterIndex(entries, 1), false);
  assert.equal(hasTaskUpdateAfterIndex(entries, 0), false);
  assert.equal(hasTaskUpdateAfterIndex(entries, -1), true);
});

test('task-like context can come from an active Melxis task or task wording', () => {
  assert.equal(hasTaskLikeContext([toolUseEntry('mcp__melxis__.task_create', { name: 'hooks' })]), true);
  assert.equal(hasTaskLikeContext([textEntry('user', 'please review this implementation')]), true);
  assert.equal(hasTaskLikeContext([textEntry('user', 'what is the weather')]), false);
});

test('substantial progress signal detects progress text and latest index', () => {
  const entries = [
    textEntry('assistant', 'starting'),
    textEntry('assistant', 'implemented the hook behavior and tested it'),
  ];

  assert.equal(hasSubstantialProgressSignal(entries), true);
  assert.equal(findLastSubstantialProgressIndex(entries), 1);
});

test('hasTaskRelatedMelUpdateAfterIndex requires related_mel_ids update', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.mel_create', { name: 'extracted insight' }),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
  ];

  assert.equal(hasTaskRelatedMelUpdateAfterIndex(entries, 0), false);
});

test('hasTaskRelatedMelUpdateAfterIndex detects task related_mel_ids backlink', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.mel_create', { name: 'extracted insight' }),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', related_mel_ids: ['m1'] }),
  ];

  assert.equal(hasTaskRelatedMelUpdateAfterIndex(entries, 0), true);
});

test('hasTaskRelatedMelUpdateAfterIndex can include the anchor entry via index - 1', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_update', {
      id: 't1',
      status: 'completed',
      related_mel_ids: ['m1'],
    }),
  ];

  assert.equal(hasTaskRelatedMelUpdateAfterIndex(entries, -1), true);
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
