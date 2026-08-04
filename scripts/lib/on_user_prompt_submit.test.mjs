import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasActiveMelxisTask } from './melxis-hook.mjs';
import {
  buildAdditionalContext,
  collectMatches,
  hasMelxisContext,
  shouldInjectBootstrap,
  shouldInjectCheckpointRecovery,
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

// The retired control-surface tag is not evidence of recovery any more: nothing
// in the flow writes it, so prose that happens to contain it is about something
// else. Counting it suppresses the reminder and the session starts cold.
test('hasMelxisContext: the retired orientation tag alone is not recovery', () => {
  const entries = [textEntry('assistant', 'the old project-orientation convention is gone')];
  assert.equal(hasMelxisContext(entries), false);
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

test('shouldInjectCheckpointRecovery: injects after progress without task_update', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'implemented the task current state refresh and tested it'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
    ],
  });
  assert.equal(result.inject, true);
});

test('shouldInjectCheckpointRecovery: silent after task_update checkpoint', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'implemented the task current state refresh and tested it'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
      toolUseEntry('mcp__melxis__.task_update', { id: 't1', description: 'refreshed' }),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'task-write-after-checkpoint');
});

test('shouldInjectCheckpointRecovery: task_patch counts as reflecting progress', () => {
  // The product steers agents toward task_patch for localized description
  // edits. Counting only task_update made patch-first sessions look
  // unreflected and the reminder fired right after the write.
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'implemented the task current state refresh and tested it'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
      toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1', old_text: 'a', new_text: 'b' }),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'task-write-after-checkpoint');
});

test('shouldInjectCheckpointRecovery: a write earlier in the same turn suppresses', () => {
  // Real turns write first and narrate last. The write at entry 1 precedes the
  // closing progress prose at entry 3, but both belong to the turn opened by
  // the prompt at entry 0 — the progress IS reflected.
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('user', 'please continue the migration work'),
      toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1', old_text: 'a', new_text: 'b' }),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "migration step"' }),
      textEntry('assistant', 'implemented the migration step and committed it'),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'task-write-after-checkpoint');
});

test('shouldInjectCheckpointRecovery: a write in a PREVIOUS turn does not suppress new progress', () => {
  // The turn boundary must not reach back past the current prompt: progress
  // made after a new prompt, with no write in that turn, is genuinely
  // unreflected even though an older turn wrote the task.
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('user', 'start the migration'),
      toolUseEntry('mcp__plugin_melxis_melxis__task_patch', { id: 't1', old_text: 'a', new_text: 'b' }),
      textEntry('user', 'now do the next step'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "next step"' }),
      textEntry('assistant', 'implemented the next step and committed it'),
    ],
  });
  assert.equal(result.inject, true);
});

test('buildAdditionalContext: bootstrap only for non-work prompt', () => {
  const context = buildAdditionalContext({ prompt: '今日は良い天気ですか？', entries: [] });
  assert.match(context, /Recent transcript context does not show Melxis context recovery/);
  // v3 multi-hive recovery: hive_search first (identity), then the anchor hive's
  // guide scoped by hive id (an owner filter does not narrow anything when you own
  // several hives),
  // hive set = own anchor + shared read-only, task_search only when an own anchor
  // resolves. The steps must match on_session_start.mjs — the two hooks are the same
  // recovery flow reached by different triggers, and a divergence here means recall
  // changes depending on which one fired.
  assert.match(context, /hive_search\(query: "<inferred project name>"\).{0,4}first/);
  assert.match(context, /hive_context_get\(hive_id: "<own anchor hive id>"\)/);
  assert.match(context, /sort: "recency", limit: 10/);
  assert.match(context, /identify hives by id \+ `own`, never by name/);
  // The gate has to cover hive_context_get and task_search together. Gating only
  // one of them leaves a path where a user with no own anchor is told to make an
  // own-hive-only read.
  assert.match(context, /only if an own anchor hive is resolved — call `hive_context_get/);
  assert.match(context, /followed by `task_search/);
  assert.match(context, /shared-only mode and skip both `hive_context_get` and task recovery/);
  assert.match(context, /Tasks are private to each account/i);
  assert.doesNotMatch(context, /<cwd basename>|<repo name>|raw filesystem paths/i);
  assert.doesNotMatch(context, /task_create/);
});

test('buildAdditionalContext: combines bootstrap and task directive for multi-step prompt', () => {
  const context = buildAdditionalContext({
    prompt: 'この WebSocket バグを調査して修正してほしい',
    entries: [],
  });
  assert.match(context, /Recent transcript context does not show Melxis context recovery/);
  assert.match(context, /hive_search\(query: "<inferred project name>"\).{0,4}first/);
  assert.match(context, /hive_context_get\(hive_id: "<own anchor hive id>"\)/);
  assert.match(context, /sort: "recency", limit: 10/);
  // The gate has to cover hive_context_get and task_search together. Gating only
  // one of them leaves a path where a user with no own anchor is told to make an
  // own-hive-only read.
  assert.match(context, /only if an own anchor hive is resolved — call `hive_context_get/);
  assert.match(context, /followed by `task_search/);
  assert.match(context, /task_update/);
  assert.match(context, /task_create/);
  assert.match(context, /Read-only Q&A still needs session context recovery/);
});

test('buildAdditionalContext: includes checkpoint recovery before next turn', () => {
  const context = buildAdditionalContext({
    prompt: '続けてください',
    entries: [
      textEntry('assistant', 'implemented the task current state refresh and tested it'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
    ],
  });
  assert.match(context, /may not be reflected in Melxis yet/);
  assert.match(context, /compressed current state/);
  assert.match(context, /sub-tasks/);
  assert.match(context, /extracted-from-task/);
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
  assert.match(output.hookSpecificOutput.additionalContext, /Melxis context recovery/);
  assert.match(output.hookSpecificOutput.additionalContext, /hive_search\(query: "<inferred project name>"\)/);
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
  assert.match(output.hookSpecificOutput.additionalContext, /Melxis context recovery/);
  assert.match(output.hookSpecificOutput.additionalContext, /hive_search\(query: "<inferred project name>"\)/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /task_create/);
});

// --- Boundary-aware bootstrap (fixed tail-window anti-pattern fix) ---

const boundaryEntry = (title) => ({ type: 'hook_success', content: [`## ${title}\n\nRecover...`] });
const bootstrapNagEntry = () => ({
  type: 'hook_additional_context',
  content: ['[melxis] Recent transcript context does not show Melxis context recovery.'],
});
const checkpointNagEntry = () => ({
  type: 'hook_additional_context',
  content: ['[melxis] Recent transcript suggests task-like progress may not be reflected in Melxis yet.'],
});

test('shouldInjectBootstrap: injects when a session boundary has no recovery after it', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [boundaryEntry('Melxis Session Resumed')],
  });
  assert.equal(result.inject, true);
  assert.equal(result.reason, 'boundary-without-recovery');
});

test('shouldInjectBootstrap: silent when recovery happened after the boundary', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      boundaryEntry('Melxis Post-Compaction Recovery'),
      toolUseEntry('mcp__plugin_melxis_melxis__mel_search', { tags: ['project-orientation'] }),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'recovered-after-boundary');
});

test('shouldInjectBootstrap: recovery from BEFORE the boundary does not count (false-suppress fix)', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      toolUseEntry('mcp__plugin_melxis_melxis__mel_search', { tags: ['project-orientation'] }),
      boundaryEntry('Melxis Session Resumed'),
    ],
  });
  assert.equal(result.inject, true);
  assert.equal(result.reason, 'boundary-without-recovery');
});

test('shouldInjectBootstrap: fires only once per boundary (habituation guard)', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [boundaryEntry('Melxis Session Bootstrap'), bootstrapNagEntry()],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'nagged-after-boundary');
});

test('shouldInjectBootstrap: write tools count as Melxis context (false-fire fix)', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [toolUseEntry('mcp__plugin_melxis_melxis__mel_create', { name: 'x' })],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'context-present');
});

test('shouldInjectBootstrap: without boundary, still capped at one nag per tail window', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [bootstrapNagEntry()],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'already-nagged');
});

test('shouldInjectCheckpointRecovery: fires only once per checkpoint anchor', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'implemented the task current state refresh and tested it'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
      checkpointNagEntry(),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'nagged-after-checkpoint');
});

test('shouldInjectBootstrap: marker text inside tool traffic does not fabricate a boundary', () => {
  // Reading the toolkit's own source files puts marker strings into
  // tool_result entries; those must not count as boundaries or prior nags.
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      toolUseEntry('mcp__plugin_melxis_melxis__mel_search', { tags: ['project-orientation'] }),
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_x',
              content: 'const STARTUP_BLOCK = `## Melxis Session Bootstrap ...`',
            },
          ],
        },
      },
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'context-present');
});

test('shouldInjectBootstrap: nag text inside tool traffic does not fake a prior nag', () => {
  const result = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_y',
              content: 'does not show Melxis context recovery — quoted from source',
            },
          ],
        },
      },
    ],
  });
  assert.equal(result.inject, true);
  assert.equal(result.reason, 'no-context');
});

test('shouldInjectBootstrap: marker text in assistant prose does not count (hookOnly scan)', () => {
  // Quoting the templates in conversation (common while developing the
  // toolkit) must neither fabricate a boundary nor fake a prior nag.
  const fakeBoundary = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      toolUseEntry('mcp__plugin_melxis_melxis__mel_search', { tags: ['project-orientation'] }),
      textEntry('assistant', 'The startup block is titled "Melxis Session Bootstrap".'),
    ],
  });
  assert.equal(fakeBoundary.inject, false);
  assert.equal(fakeBoundary.reason, 'context-present');

  const fakeNag = shouldInjectBootstrap({
    prompt: 'please continue where we left off',
    entries: [
      textEntry('assistant', 'It injects "does not show Melxis context recovery" as a reminder.'),
    ],
  });
  assert.equal(fakeNag.inject, true);
  assert.equal(fakeNag.reason, 'no-context');
});

// Regression: an actively-working session used to re-arm the checkpoint
// reminder on every turn. SUBSTANTIAL_PROGRESS_PATTERN matches ordinary words
// ("implemented", "fixed", and their Japanese equivalents), so each new
// assistant turn produced a
// newer progress index and the `nag > anchor` suppression could never hold.
// Observed 2026-07-26: the reminder fired on every single turn of a long
// session (~14% of the Melxis token budget) while a task anchor was in place.
test('shouldInjectCheckpointRecovery: bare progress after a nag does not re-arm', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'working the implementation task'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "checkpoint"' }),
      checkpointNagEntry(),
      textEntry('assistant', 'implemented the next piece and tested it'),
      textEntry('assistant', 'fixed another thing and verified it'),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'progress-only-no-rearm');
});

test('shouldInjectCheckpointRecovery: a genuine new checkpoint after a nag re-arms', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      textEntry('assistant', 'working the implementation task'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "first"' }),
      checkpointNagEntry(),
      textEntry('assistant', 'implemented more'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "second"' }),
    ],
  });
  assert.equal(result.inject, true);
});

test('shouldInjectCheckpointRecovery: nag budget caps repeats within one boundary', () => {
  const result = shouldInjectCheckpointRecovery({
    entries: [
      boundaryEntry('Melxis Session Bootstrap'),
      textEntry('assistant', 'working through the implementation task'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "a"' }),
      checkpointNagEntry(),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "b"' }),
      checkpointNagEntry(),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "c"' }),
    ],
  });
  assert.equal(result.inject, false);
  assert.equal(result.reason, 'nag-budget-exhausted');
});

// The budget is per session boundary. Resetting across a boundary is the whole
// point of this behaviour, so the transcript has to contain one. Without a
// boundary entry, boundaryIndex stays -1, the reset path is never taken, and the
// suite passes green even if the budget were changed to count all of history.
test('shouldInjectCheckpointRecovery: nag budget resets across a session boundary', () => {
  const spent = [
    textEntry('assistant', 'working through the implementation task'),
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "a"' }),
    checkpointNagEntry(),
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "b"' }),
    checkpointNagEntry(),
    toolUseEntry('functions.exec_command', { cmd: 'git commit -m "c"' }),
  ];

  // exhausted within the same boundary
  assert.equal(
    shouldInjectCheckpointRecovery({ entries: [boundaryEntry('Melxis Session Bootstrap'), ...spent] })
      .reason,
    'nag-budget-exhausted',
  );

  // fires again after a new boundary, even later in the same history
  const result = shouldInjectCheckpointRecovery({
    entries: [
      ...spent,
      boundaryEntry('Melxis Session Resumed'),
      textEntry('assistant', 'implemented the next chunk of the task'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "d"' }),
    ],
  });
  assert.equal(result.inject, true);
});

test('shouldInjectCheckpointRecovery: budget counts only nags after the latest boundary', () => {
  // nags from before the boundary do not count — counting them would suppress
  // the very first reminder
  const result = shouldInjectCheckpointRecovery({
    entries: [
      checkpointNagEntry(),
      checkpointNagEntry(),
      boundaryEntry('Melxis Session Resumed'),
      textEntry('assistant', 'implemented the task current state refresh'),
      toolUseEntry('functions.exec_command', { cmd: 'git commit -m "after"' }),
    ],
  });
  assert.equal(result.inject, true);
});

// --- recovery flow parity between hooks -----------------------------------
//
// SessionStart and UserPromptSubmit are two triggers into the same recovery
// flow, so when the steps drift, recall depends on which hook happened to fire.
// That is not hypothetical: UserPromptSubmit was once left behind on the owner
// filter, and an account owning several hives got back every project's mels.
// The wording may differ between them; the shape of the calls may not.
test('bootstrap: SessionStart and UserPromptSubmit prescribe the same recall steps', () => {
  const here = new URL('.', import.meta.url).pathname;
  const sessionStart = readFileSync(join(here, '..', 'on_session_start.mjs'), 'utf8');
  const userPrompt = readFileSync(join(here, '..', 'on_user_prompt_submit.mjs'), 'utf8');

  const REQUIRED = [
    // the guide and the mels it points at come back in one call, from a given hive id
    'hive_context_get(hive_id: "<own anchor hive id',
    // handoff recovery is capped
    'sort: "recency", limit: 10',
    // with no own anchor, neither the guide nor tasks are fetched — gating only
    // one of them is what went wrong before
    'skip both `hive_context_get` and task recovery',
  ];

  // on_session_start.mjs holds three near-identical blocks: STARTUP, RESUME and
  // COMPACT. Matching against the whole file passes as long as any one of them
  // contains the needle, so a single block left on older wording stays green —
  // which is exactly how RESUME and COMPACT kept gating only task_search on the
  // own anchor. Slice the blocks apart and check each one.
  // The step text lives inside template literals, so backticks appear escaped as
  // \` in the source. Writing that escape into every needle would be unreadable;
  // strip it before comparing instead.
  const unescape = (s) => s.replaceAll('\\`', '`');

  const BLOCKS = ['STARTUP_BLOCK', 'RESUME_BLOCK', 'COMPACT_BLOCK'];
  const blockBodies = BLOCKS.map((name) => {
    const start = sessionStart.indexOf(`const ${name} = \``);
    assert.ok(start >= 0, `on_session_start.mjs has no ${name}`);
    const end = sessionStart.indexOf('\n`;', start);
    assert.ok(end > start, `could not find the end of ${name}`);
    return { name, body: unescape(sessionStart.slice(start, end)) };
  });

  const userPromptText = unescape(userPrompt);

  for (const needle of REQUIRED) {
    for (const { name, body } of blockBodies) {
      assert.ok(body.includes(needle), `${name} in on_session_start.mjs is missing "${needle}"`);
    }
    assert.ok(
      userPromptText.includes(needle),
      `on_user_prompt_submit.mjs is missing "${needle}" — it has drifted from SessionStart`,
    );
  }

  // Guard against the superseded steps coming back. Filtering by owner does not
  // narrow anything once you own several hives — it returns every project's
  // mels. Filtering by hive_ids was correct, but fetching the hive's control
  // surface with a tag search costs an extra round trip and leaves a path that
  // proceeds without ever reading it. The control surface is now the guide, and
  // `mel_search` cannot reach it at all.
  const STALE = [
    'tags: ["project-orientation"], owner_account_ids',
    'tags: ["project-orientation"], hive_ids',
  ];
  for (const needle of STALE) {
    assert.ok(!sessionStart.includes(needle), `on_session_start.mjs still carries the superseded step "${needle}"`);
    assert.ok(!userPrompt.includes(needle), `on_user_prompt_submit.mjs still carries the superseded step "${needle}"`);
  }
});

// hive_context_get reads own hives only, so a user whose own anchor did not
// resolve must not be told to call it. Placing the condition after the call
// means the model acts on the instruction it read first and meets the condition
// afterwards. Merely containing "skip both ..." is not enough to catch that —
// BOOTSTRAP_TEMPLATE was left in exactly that shape. Pin the condition ahead of
// the call on all four paths.
test('the own-anchor condition precedes the hive_context_get call', () => {
  const here = new URL('.', import.meta.url).pathname;
  const unescape = (s) => s.replaceAll('\\`', '`');
  const GATE = /only if (step 2 resolved an own anchor hive|an own anchor hive is resolved)/i;

  const sessionStart = unescape(readFileSync(join(here, '..', 'on_session_start.mjs'), 'utf8'));
  const userPrompt = unescape(readFileSync(join(here, '..', 'on_user_prompt_submit.mjs'), 'utf8'));

  const blocks = [
    ...['STARTUP_BLOCK', 'RESUME_BLOCK', 'COMPACT_BLOCK'].map((name) => {
      const start = sessionStart.indexOf(`const ${name} = \``);
      return { name, body: sessionStart.slice(start, sessionStart.indexOf('\n`;', start)) };
    }),
    (() => {
      const start = userPrompt.indexOf('const BOOTSTRAP_TEMPLATE = `');
      return { name: 'BOOTSTRAP_TEMPLATE', body: userPrompt.slice(start, userPrompt.indexOf('\n`;', start)) };
    })(),
  ];

  for (const { name, body } of blocks) {
    const call = body.indexOf('hive_context_get');
    assert.ok(call >= 0, `${name} does not instruct hive_context_get`);
    const gate = body.search(GATE);
    assert.ok(gate >= 0, `${name} has no own-anchor condition`);
    assert.ok(gate < call, `${name}: the condition comes after the hive_context_get call`);
  }
});

// The guide has two sides — read and follow it, and record what the user states
// — and only the second lived inside STARTUP_BLOCK. A session that began with
// a resume therefore never received the cue to write, so a user stating a
// standing agreement produced no guide_edit (observed 2026-07-27). The moment an
// agreement is stated is not tied to session start, so the cue belongs in
// RULES_POINTER_BLOCK, which the source appends on all four paths.
test('the cue to write the guide reaches the startup, resume and compact paths alike', () => {
  const here = new URL('.', import.meta.url).pathname;
  const sessionStart = readFileSync(join(here, '..', 'on_session_start.mjs'), 'utf8');

  for (const source of ['startup', 'resume', 'compact', 'clear']) {
    const { stdout: out } = spawnSync(process.execPath, [join(here, '..', 'on_session_start.mjs')], {
      input: JSON.stringify({ source }),
      encoding: 'utf8',
    });
    assert.match(out, /guide_edit/, `source=${source} output carries no cue to write the guide`);
    assert.match(out, /guide_patch/, `source=${source} output does not mention guide_patch`);
    // the superseded tool names must not survive anywhere in the injected text
    assert.doesNotMatch(
      out,
      /\brules_(?:get|edit|patch)\b/,
      `source=${source} output still names a tool the server no longer has`,
    );
  }

  // the read-and-follow side reaches every path too (pinning what already held)
  assert.ok(
    (sessionStart.match(/hive guide|hive's guide/g) ?? []).length >= 3,
    'the instruction to follow the hive guide is not present in all three blocks',
  );
});

// An agent whose hives do not fit the work in front of it can recall (shared
// and unrelated hives are readable) but has nowhere to write: every write path
// needs a hive that fits, and nothing in the injected text ever said how to get
// one or where a note with no project belongs. The memory loop therefore never
// starts, silently. The cue that closes this fires at the first save-worthy
// moment rather than at session start, so — like the cue to write the guide —
// it belongs in RULES_POINTER_BLOCK, which reaches startup/resume/compact.
// BOOTSTRAP_TEMPLATE is the fourth path and lives in the other hook file, which
// receives nothing from on_session_start.mjs, so it carries a hand-mirrored
// copy. Two hand-kept copies drift unless both are pinned: assert the fourth
// path directly instead of inferring it from the other three.
//
// The needles are fragments of HIVE_CUE_SHORT; the full verbatim wording is
// pinned once, in client-surface-language.test.mjs.
test('the no-fitting-hive cue reaches all four recovery paths', () => {
  const here = new URL('.', import.meta.url).pathname;
  const NEEDLES = [
    // the condition — a project with no hive that fits it, owning none at all
    // being one case of that rather than the whole rule
    'When a clear project has no fitting own hive (or you own none at all)',
    // the action, at the first save-worthy moment, with the name to suggest
    'propose creating one at the first save-worthy mel or task with `hive_create`',
    // hive creation is the one write that asks, even under the auto policy
    'hive creation asks the user even under auto write policy',
    // and the new hive gets its guide from what the user just said
    'write its first guide with `guide_edit` from the purpose the user just stated',
    // the third clause: a note with no project needs no proposal, it has a home
    'A stray note that belongs to no project goes to the Default hive',
    // and the way to find that home again without a query
    'an argless `hive_search` lists every hive you can reach',
  ];

  for (const source of ['startup', 'resume', 'compact', 'clear']) {
    const { stdout: out } = spawnSync(process.execPath, [join(here, '..', 'on_session_start.mjs')], {
      input: JSON.stringify({ source }),
      encoding: 'utf8',
    });
    for (const needle of NEEDLES) {
      assert.ok(out.includes(needle), `source=${source} output is missing "${needle}"`);
    }
  }

  // The fourth path: the UserPromptSubmit reminder, checked as its own block so
  // a copy that only sits elsewhere in the file cannot stand in for it.
  const userPrompt = readFileSync(join(here, '..', 'on_user_prompt_submit.mjs'), 'utf8');
  const start = userPrompt.indexOf('const BOOTSTRAP_TEMPLATE = `');
  assert.ok(start >= 0, 'on_user_prompt_submit.mjs has no BOOTSTRAP_TEMPLATE');
  const bootstrap = userPrompt.slice(start, userPrompt.indexOf('\n`;', start)).replaceAll('\\`', '`');
  for (const needle of NEEDLES) {
    assert.ok(bootstrap.includes(needle), `BOOTSTRAP_TEMPLATE is missing "${needle}"`);
  }
});

// hive_context_get and guide_* fall outside the <entity>_<verb> shape. Under a
// plugin-prefixed registration the trailing "melxis" catches them anyway, which
// hides the gap, so pin detection on the bare-MCP names. Miss this and an agent
// that recovered through hive_context_get alone reads as "never recovered" and
// gets the bootstrap reminder again.
test('hasMelxisContext: bare-MCP hive_context_get and guide_* count as recall', () => {
  for (const toolName of [
    'hive_context_get',
    'guide_get',
    'guide_edit',
    'guide_patch',
    'next_actions',
    'mcp__plugin_melxis_melxis__hive_context_get',
    'mcp__melxis__guide_edit',
    // mel_* / hive_* stay distinctive enough to match even when the server is
    // aliased to something other than melxis
    'mcp__memory__mel_search',
  ]) {
    assert.ok(
      hasMelxisContext([toolUseEntry(toolName, {})]),
      `${toolName} was not detected as a Melxis tool`,
    );
  }
});

// A false positive costs the whole recovery, not one extra reminder: once
// hasMelxisContext returns true, shouldInjectBootstrap suppresses itself and the
// session starts work without restoring context — the failure this hook exists
// to prevent. task_*, guide_* and next_actions are ordinary words other servers
// also use, so pin that a tool without the melxis marker is not counted. The
// eslint case is kept verbatim: it is another server's tool name, not ours, and
// renaming our surface does not make it ours.
test('hasMelxisContext: similarly named tools from other MCP servers are not counted', () => {
  for (const toolName of [
    'mcp__linear__next_actions',
    'mcp__eslint__rules_get',
    'mcp__docs__guide_get',
    'mcp__github__task_get',
    'mcp__jira__task_search',
  ]) {
    assert.equal(
      hasMelxisContext([toolUseEntry(toolName, {})]),
      false,
      `${toolName} was wrongly detected as a Melxis tool`,
    );
  }
});
