import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  extractText, parseTranscript, hasToolCallMatching, hasActiveMelxisTask,
  hasTaskWriteAfterIndex, findTurnStartIndex, findLastCaptureAnchorIndex,
  findLastSubstantialProgressIndex, extractOperationCheckpoints,
  findLastEntryIndexMatching,
} from './melxis-hook.mjs';
import {
  shouldInjectBootstrap, shouldInjectDirective, shouldInjectCheckpointRecovery,
} from '../on_user_prompt_submit.mjs';

const prompt = 'please continue';
const nag = '[melxis] Recent transcript context does not show Melxis context recovery.';
const codexMessage = (role, text, metadata) => ({
  type: 'response_item',
  payload: {
    type: 'message', role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
    ...(metadata && { internal_chat_message_metadata_passthrough: metadata }),
  },
});
const codexCall = (tool, input = {}, overrides = {}) => ({
  type: 'event_msg',
  payload: {
    type: 'item_completed',
    item: {
      type: 'McpToolCall', id: 'call-1', server: 'melxis', tool,
      arguments: input, status: 'completed',
      result: { content: [{ type: 'text', text: '{}' }] },
      ...overrides,
    },
  },
});
const formats = {
  claude: {
    message: (role, text) => ({ message: { role, content: [{ type: 'text', text }] } }),
    hook: text => ({ type: 'hook_additional_context', content: [text] }),
    call: (tool, input = {}) => ({ message: { role: 'assistant', content: [
      { type: 'tool_use', name: `mcp__melxis__${tool}`, input },
    ] } }),
  },
  codex: {
    message: codexMessage,
    hook: text => codexMessage('developer', text, { content_item_kinds: ['hooks.additional_context'] }),
    call: codexCall,
  },
};
const decide = entries => shouldInjectBootstrap({ prompt, entries });

for (const [format, { message, hook, call }] of Object.entries(formats)) {
  test(`${format}: recovery backstop stops after a real tool call`, () => {
    const entries = [hook('## Melxis Session Bootstrap'), message('user', prompt)];
    assert.equal(decide(entries).inject, true);
    entries.push(call('hive_context_get', { hive_id: 'hive-1' }));
    assert.deepEqual(decide(entries), { inject: false, reason: 'recovered-after-boundary' });
    assert.deepEqual(decide(parseTranscript(entries.map(e => JSON.stringify(e)))), decide(entries));
  });

  test(`${format}: a prior reminder stops repeated injection even without recovery`, () => {
    assert.deepEqual(decide([hook(nag)]), { inject: false, reason: 'already-nagged' });
    assert.deepEqual(decide([hook('## Melxis Session Bootstrap'), hook(nag)]), {
      inject: false, reason: 'nagged-after-boundary',
    });
  });

  test(`${format}: executable hook reads JSONL and only emits recovery when needed`, () => {
    const dir = mkdtempSync(resolve(process.cwd(), '.tmp-transcript-format-'));
    try {
      const path = join(dir, 'transcript.jsonl');
      const entries = [hook('## Melxis Session Bootstrap')];
      for (const recovered of [false, true]) {
        if (recovered) entries.push(call('hive_context_get', { hive_id: 'hive-1' }));
        writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
        const result = spawnSync(process.execPath, ['scripts/on_user_prompt_submit.mjs'], {
          cwd: new URL('../..', import.meta.url), encoding: 'utf8',
          input: JSON.stringify({ prompt, transcript_path: path }),
        });
        assert.equal(result.status, 0);
        assert.equal(result.stderr, '');
        if (recovered) assert.equal(result.stdout, '');
        else {
          const output = JSON.parse(result.stdout).hookSpecificOutput;
          assert.equal(output.hookEventName, 'UserPromptSubmit');
          assert.ok(output.additionalContext.startsWith(nag));
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const title of ['Melxis Session Resumed', 'Melxis Post-Compaction Recovery']) {
    test(`${format}: ${title} requires fresh recovery`, () => {
      const entries = [call('hive_search'), hook(nag), hook(`## ${title}`)];
      assert.deepEqual(decide(entries), { inject: true, reason: 'boundary-without-recovery' });
      entries.push(call('hive_context_get'));
      assert.equal(decide(entries).inject, false);
    });
  }

  test(`${format}: task lifecycle and writes use the same call evidence`, () => {
    const entries = [call('task_create', { title: 'Work' })];
    assert.equal(hasActiveMelxisTask(entries), true);
    entries.push(call('task_patch', { id: 't1', status: 'completed' }));
    assert.equal(hasActiveMelxisTask(entries), false);
    entries.push(call('task_update', { id: 't2', status: 'in_progress' }));
    assert.equal(shouldInjectDirective({ prompt: 'please investigate and fix this bug', entries }).inject, false);
    assert.equal(hasTaskWriteAfterIndex([call('task_note', { id: 't2', content: 'Finding' })], -1), true);
    assert.equal(hasTaskWriteAfterIndex([call('task_search')], -1), false);
  });

  test(`${format}: message text and turn boundaries share one interpretation`, () => {
    const entries = [
      message('user', 'please fix the bug'),
      call('task_patch', { id: 't1', old_text: 'a', new_text: 'b' }),
      message('assistant', 'fixed the bug and tested it'),
    ];
    assert.equal(findTurnStartIndex(entries, 2), 0);
    assert.equal(findLastSubstantialProgressIndex(entries), 2);
    assert.equal(shouldInjectCheckpointRecovery({ entries }).inject, false);
    assert.equal(extractText(entries), 'please fix the bug\nfixed the bug and tested it');
    entries.push(hook('## Melxis Post-Compaction Recovery'), message('assistant', 'implemented another fix'));
    assert.equal(findTurnStartIndex(entries, 4), 3);
    assert.equal(shouldInjectCheckpointRecovery({ entries }).inject, true);
    entries.push(message('user', 'I prefer this approach'));
    assert.equal(findLastCaptureAnchorIndex(entries), 5);
  });

  test(`${format}: names inside tool arguments are data, not tool executions`, () => {
    const entries = [call('hive_search', {
      name: 'task_update', input: { status: 'in_progress' },
      nested: { name: 'exec_command', input: { cmd: 'git push' } },
    })];
    assert.equal(hasActiveMelxisTask(entries), false);
    assert.equal(hasTaskWriteAfterIndex(entries, -1), false);
    assert.deepEqual(extractOperationCheckpoints(entries), []);
  });
}

test('Codex: a wrapper is not evidence that its nested MCP call executed', () => {
  const wrapper = { type: 'response_item', payload: {
    type: 'custom_tool_call', name: 'exec',
    input: 'text(await tools.mcp__melxis__hive_search({query:"project"}));',
  } };
  assert.equal(decide([wrapper]).inject, true);
  assert.equal(decide([wrapper, codexCall('hive_search')]).inject, false);
});

test('Codex: failed, pending and MCP-error calls do not count as successful activity', () => {
  for (const overrides of [
    { status: 'failed', result: null, error: { message: 'Connection failed' } },
    { status: 'inProgress', result: null },
    { result: null },
    { result: { isError: true, content: [{ type: 'text', text: 'Denied' }] } },
  ]) {
    const entries = [codexCall('task_create', { title: 'Work' }, overrides)];
    assert.equal(decide(entries).inject, true);
    assert.equal(hasActiveMelxisTask(entries), false);
    assert.equal(hasTaskWriteAfterIndex(entries, -1), false);
  }
  const started = codexCall('hive_search');
  started.payload.type = 'item_started';
  assert.equal(decide([started]).inject, true);
});

test('Codex: result names and quoted calls cannot suppress recovery or open a task', () => {
  const result = { content: [{ type: 'text', text: JSON.stringify({
    name: 'Melxis', tool_uses: [{ name: 'task_create', input: { title: 'Work' } }],
  }) }] };
  const entries = [codexCall('list_products', {}, { server: 'catalog', result })];
  assert.equal(decide(entries).inject, true);
  assert.equal(hasActiveMelxisTask(entries), false);
  assert.equal(hasTaskWriteAfterIndex(entries, -1), false);
});

test('Claude: results containing serialized tool calls remain data', () => {
  const entries = [{ message: { role: 'user', content: [{
    type: 'tool_result', content: JSON.stringify({
      name: 'task_create', input: { title: 'Work' },
    }),
  }] } }];
  assert.equal(decide(entries).inject, true);
  assert.equal(hasActiveMelxisTask(entries), false);
});

test('Codex: only hook metadata on developer messages identifies a real hook', () => {
  const metadata = { content_item_kinds: ['hooks.additional_context'] };
  for (const entry of [
    codexMessage('developer', nag),
    codexMessage('assistant', nag, metadata),
    codexMessage('user', nag, metadata),
  ]) assert.equal(decide([entry]).inject, true);
  assert.equal(decide([codexMessage('developer', nag, metadata)]).inject, false);
  assert.equal(findLastCaptureAnchorIndex([
    codexMessage('developer', 'I prefer this approach', metadata),
  ]), -1);
});

test('Codex: response output and UI event copies do not become calls or duplicate text', () => {
  const entries = [
    { type: 'response_item', payload: { type: 'function_call_output', output: '{"name":"Melxis"}' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', text: 'fixed it' } } },
    codexMessage('assistant', 'fixed it'),
  ];
  assert.equal(decide(entries).inject, true);
  assert.equal(extractText(entries), 'fixed it');
});

test('shared extraction retains bare, function and multi-tool call containers', () => {
  for (const entry of [
    { name: 'functions.exec_command', input: { cmd: 'git push' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'functions.exec_command', arguments: '{"cmd":"git push"}' } },
    { tool_uses: [{ recipient_name: 'functions.exec_command', parameters: { cmd: 'git push' } }] },
    { name: 'multi_tool_use.parallel', arguments: JSON.stringify({ tool_uses: [
      { recipient_name: 'functions.exec_command', parameters: { cmd: 'git push' } },
    ] }) },
  ]) {
    assert.equal(extractOperationCheckpoints([entry])[0]?.kind, 'git push');
    assert.equal(hasToolCallMatching([entry], /exec_command/), true);
  }
});

test('executable hook reports unavailable and malformed logs without asking for recovery', () => {
  const dir = mkdtempSync(resolve(process.cwd(), '.tmp-unreadable-transcript-'));
  try {
    const malformed = join(dir, 'malformed.jsonl');
    writeFileSync(malformed, 'not json\n');
    for (const path of [null, join(dir, 'missing.jsonl'), malformed]) {
      const result = spawnSync(process.execPath, ['scripts/on_user_prompt_submit.mjs'], {
        cwd: new URL('../..', import.meta.url), encoding: 'utf8',
        input: JSON.stringify({ prompt, transcript_path: path }),
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /recovery state is unknown/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict parsing tolerates an incomplete final line when earlier records are readable', () => {
  const entry = codexCall('hive_search');
  assert.deepEqual(parseTranscript([JSON.stringify(entry), '{'], { strict: true }), [entry]);
  assert.deepEqual(parseTranscript(['{']), []);
});

// --- A rollout captured from Codex CLI 0.154.0 ------------------------------
//
// The codexMessage / codexCall helpers above are assumptions about the host's
// log. This fixture is the check that they still hold: two turns stitched
// from one rollout recorded on 2026-09-18, every text replaced by a
// placeholder, ids shortened and ordinals / timestamps renumbered so the
// order is monotonic, the envelopes verbatim. When a Codex release changes
// its log, the parser fails here, at test time — an unreadable transcript is
// measured, not nagged about at prompt time (the hook stays silent on it by
// design).
const CODEX_FIXTURE = new URL('./fixtures/codex-cli-0.154.0-rollout.jsonl', import.meta.url);
const fixtureLines = () => readFileSync(CODEX_FIXTURE, 'utf8').split('\n').filter(Boolean);

test('codex fixture: every record of the rollout parses in strict mode', () => {
  const lines = fixtureLines();
  assert.equal(parseTranscript(lines, { strict: true }).length, lines.length);
});

test('codex fixture: the bootstrap reminder stops at the first MCP completion event', () => {
  const entries = parseTranscript(fixtureLines());
  const userIndex = entries.findIndex(e => e.type === 'response_item' && e.payload?.role === 'user');
  const recoveredIndex = entries.findIndex(e => e.payload?.item?.tool === 'hive_context_get');
  assert.ok(userIndex > 0 && recoveredIndex > userIndex);
  assert.deepEqual(decide(entries.slice(0, userIndex + 1)), { inject: true, reason: 'boundary-without-recovery' });
  assert.deepEqual(decide(entries.slice(0, recoveredIndex + 1)), { inject: false, reason: 'recovered-after-boundary' });
});

test('codex fixture: an MCP call surfaces once, from item_completed, never from code-mode source', () => {
  const entries = parseTranscript(fixtureLines());
  // Code-mode wraps the MCP call in an `exec` custom_tool_call whose source
  // string names the tool; the built-in `wait` arrives as a function_call.
  // Both surface under their own names; only the McpToolCall event carries
  // the MCP name, so a call is never counted twice.
  assert.equal(hasToolCallMatching(entries, /^exec$/), true);
  assert.equal(hasToolCallMatching(entries, /^wait$/), true);
  const carriers = entries.filter(e => hasToolCallMatching([e], /hive_search/)).map(e => e.type);
  assert.deepEqual(carriers, ['event_msg']);
});

test('codex fixture: developer messages other than hook context are neither hooks nor prose', () => {
  const entries = parseTranscript(fixtureLines());
  assert.ok(findLastEntryIndexMatching(entries, /Melxis Session Bootstrap/, { hookOnly: true }) >= 0);
  assert.equal(findLastEntryIndexMatching(entries, /interrupted on purpose/, { hookOnly: true }), -1);
  const text = extractText(entries);
  assert.match(text, /no open handoff task/);
  assert.doesNotMatch(text, /interrupted on purpose/);
});

test('codex fixture: a completed shell command is a checkpoint, a failed one is not', () => {
  const entries = parseTranscript(fixtureLines());
  // A shell command reaches the log twice: the code-mode `exec` source names
  // exec_command, and the CommandExecution completion event carries what ran.
  // Only the completion event counts, so the commit is one checkpoint; the
  // push that Codex marked failed is none; git status is no checkpoint at all.
  const checkpoints = extractOperationCheckpoints(entries);
  assert.deepEqual(checkpoints.map(c => c.kind), ['git commit']);
  assert.equal(checkpoints[0].command, "git commit -am 'Fix the hook'");
  assert.equal(entries[checkpoints[0].entryIndex].payload?.item?.type, 'CommandExecution');
});

test('codex fixture: the checkpoint reminder arms after the commit and the recovery decisions stay put', () => {
  const entries = parseTranscript(fixtureLines());
  assert.equal(shouldInjectCheckpointRecovery({ entries }).inject, true);
  assert.deepEqual(decide(entries), { inject: false, reason: 'recovered-after-boundary' });
  assert.equal(hasActiveMelxisTask(entries), false);
});

test('codex fixture: a compaction record does not replay its history as prose', () => {
  const text = extractText(parseTranscript(fixtureLines()));
  assert.equal(text.split('Please check where the project stands.').length - 1, 1);
});
