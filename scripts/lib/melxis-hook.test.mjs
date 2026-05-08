import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOperationCheckpoints,
  hasToolCallMatchingAfterIndex,
} from './melxis-hook.mjs';

const MELXIS_WRITE_TOOL =
  /(?:^|[._-])(mel_create|task_create|mel_update|mel_patch|task_update|mel_link_create)(?:[._-]|$)/;

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
