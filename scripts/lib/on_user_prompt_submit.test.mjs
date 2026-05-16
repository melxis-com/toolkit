import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { hasActiveMelxisTask } from './melxis-hook.mjs';
import {
  buildAdditionalContext,
  collectMatches,
  hasMelxisContext,
  shouldInjectBootstrap,
  shouldInjectDirective,
} from '../on_user_prompt_submit.mjs';

function toolUseEntry(name, input) {
  return { message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } };
}

function textEntry(role, text) {
  return { message: { role, content: text } };
}

// --- hasActiveMelxisTask --------------------------------------------------

test('hasActiveMelxisTask: returns false on empty entries', () => {
  assert.equal(hasActiveMelxisTask([]), false);
});

test('hasActiveMelxisTask: returns true after task_create', () => {
  const entries = [toolUseEntry('mcp__melxis__.task_create', { name: 'do thing' })];
  assert.equal(hasActiveMelxisTask(entries), true);
});

test('hasActiveMelxisTask: returns true after task_update(status=in_progress)', () => {
  const entries = [toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' })];
  assert.equal(hasActiveMelxisTask(entries), true);
});

test('hasActiveMelxisTask: completed transition clears active', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_create', { name: 'thing' }),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
  ];
  assert.equal(hasActiveMelxisTask(entries), false);
});

test('hasActiveMelxisTask: cancelled transition clears active', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'in_progress' }),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'cancelled' }),
  ];
  assert.equal(hasActiveMelxisTask(entries), false);
});

test('hasActiveMelxisTask: re-open after close returns true', () => {
  const entries = [
    toolUseEntry('mcp__melxis__.task_create', { name: 'first' }),
    toolUseEntry('mcp__melxis__.task_update', { id: 't1', status: 'completed' }),
    toolUseEntry('mcp__melxis__.task_create', { name: 'second' }),
  ];
  assert.equal(hasActiveMelxisTask(entries), true);
});

// --- collectMatches -------------------------------------------------------

test('collectMatches: JP multi-step keyword', () => {
  const out = collectMatches('このバグを修正してください');
  assert.deepEqual(out, ['修正']);
});

test('collectMatches: EN multi-step keyword', () => {
  const out = collectMatches('Please implement the new feature');
  assert.deepEqual(out.map((s) => s.toLowerCase()), ['implement']);
});

test('collectMatches: returns empty for non-multi-step prompt', () => {
  assert.deepEqual(collectMatches('hello there how are you today'), []);
});

test('collectMatches: dedupes repeated matches', () => {
  const out = collectMatches('修正 修正 修正');
  assert.deepEqual(out, ['修正']);
});

// --- shouldInjectDirective ------------------------------------------------

test('shouldInjectDirective: injects on multi-step JP prompt with no active task', () => {
  const result = shouldInjectDirective({
    prompt: 'この WebSocket バグを調査して修正してほしい',
    entries: [],
  });
  assert.equal(result.inject, true);
  assert.ok(result.matched.includes('調査') || result.matched.includes('修正'));
});

test('shouldInjectDirective: injects on multi-step EN prompt with no active task', () => {
  const result = shouldInjectDirective({
    prompt: 'Please refactor the authentication module to support OIDC',
    entries: [],
  });
  assert.equal(result.inject, true);
});

test('shouldInjectDirective: silent when an active task is in play', () => {
  const result = shouldInjectDirective({
    prompt: 'この WebSocket バグを調査して修正してほしい',
    entries: [toolUseEntry('mcp__melxis__.task_create', { name: 'ws-bug' })],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'active-task');
});

test('shouldInjectDirective: silent on short prompt', () => {
  const result = shouldInjectDirective({ prompt: '修正して', entries: [] });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'short');
});

test('shouldInjectDirective: silent on trivial-marked prompt', () => {
  const result = shouldInjectDirective({
    prompt: 'ちょっと typo を修正してほしいんだけど',
    entries: [],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'trivial');
});

test('shouldInjectDirective: silent on no-keyword prompt', () => {
  const result = shouldInjectDirective({
    prompt: 'how does the websocket connection lifecycle work in detail',
    entries: [],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'no-keyword');
});

test('shouldInjectDirective: directive output template includes task anchoring', () => {
  // smoke check on the constants used by the main flow — they should mention
  // task_update / task_create so the agent knows how to anchor the work.
  const result = shouldInjectDirective({
    prompt: 'リファクタしてほしい大規模な作業があります',
    entries: [],
  });
  assert.equal(result.inject, true);
  assert.ok(Array.isArray(result.matched));
});

// --- context recovery -----------------------------------------------------

test('hasMelxisContext: false on empty transcript', () => {
  assert.equal(hasMelxisContext([]), false);
});

test('hasMelxisContext: true after Melxis tool call', () => {
  const entries = [toolUseEntry('mcp__melxis__.mel_search', { query: 'melxis' })];
  assert.equal(hasMelxisContext(entries), true);
});

test('hasMelxisContext: true after visible plugin context text', () => {
  const entries = [textEntry('assistant', 'melxis hive context loaded')];
  assert.equal(hasMelxisContext(entries), true);
});

test('shouldInjectBootstrap: injects for normal prompt without Melxis context', () => {
  const result = shouldInjectBootstrap({ prompt: '今日は良い天気ですか？', entries: [] });
  assert.equal(result.inject, true);
});

test('shouldInjectBootstrap: silent for slash commands', () => {
  const result = shouldInjectBootstrap({ prompt: '/clear', entries: [] });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'command-or-empty');
});

test('shouldInjectBootstrap: silent when Melxis context is already present', () => {
  const result = shouldInjectBootstrap({
    prompt: '今日は良い天気ですか？',
    entries: [toolUseEntry('mcp__melxis__.task_search', { status: 'in_progress' })],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'context-present');
});

test('buildAdditionalContext: bootstrap only for non-work prompt', () => {
  const context = buildAdditionalContext({ prompt: '今日は良い天気ですか？', entries: [] });
  assert.match(context, /Recent transcript context does not show Melxis bootstrap/);
  assert.doesNotMatch(context, /task_create/);
});

test('buildAdditionalContext: combines bootstrap and task directive for multi-step prompt', () => {
  const context = buildAdditionalContext({
    prompt: 'この WebSocket バグを調査して修正してほしい',
    entries: [],
  });
  assert.match(context, /Recent transcript context does not show Melxis bootstrap/);
  assert.match(context, /task_update/);
  assert.match(context, /task_create/);
});

// --- executable output contract ------------------------------------------

test('main hook emits UserPromptSubmit additionalContext JSON', () => {
  const child = spawnSync(process.execPath, ['scripts/on_user_prompt_submit.mjs'], {
    cwd: new URL('../..', import.meta.url),
    input: JSON.stringify({
      prompt: 'この WebSocket バグを調査して修正してほしい',
      transcript_path: '',
    }),
    encoding: 'utf8',
  });

  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');

  const output = JSON.parse(child.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /Melxis bootstrap/);
  assert.match(output.hookSpecificOutput.additionalContext, /task_create/);
});

test('main hook emits bootstrap JSON for cleared-context prompt', () => {
  const child = spawnSync(process.execPath, ['scripts/on_user_prompt_submit.mjs'], {
    cwd: new URL('../..', import.meta.url),
    input: JSON.stringify({
      prompt: '今日は良い天気ですか？',
      transcript_path: '',
    }),
    encoding: 'utf8',
  });

  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');

  const output = JSON.parse(child.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /Melxis bootstrap/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /task_create/);
});
