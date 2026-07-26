import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url);

const CLIENT_SURFACE_FILES = [
  'AGENTS.md',
  'scripts/on_session_start.mjs',
  'scripts/on_stop.mjs',
  'scripts/on_user_prompt_submit.mjs',
  'skills/memory/SKILL.md',
  'skills/task/SKILL.md',
];

function readSurface() {
  return CLIENT_SURFACE_FILES.map((file) => ({
    file,
    text: readFileSync(join(ROOT.pathname, file), 'utf8'),
  }));
}

test('client surface avoids create-first Melxis memory/task wording', () => {
  const banned = [
    /MUST be `task_create`/i,
    /propose `task_create` BEFORE/i,
    /create the task retroactively/i,
    /create\/link mels/i,
    /Flow\s+.*save\s*\(mel_create\s*\+\s*mel_link_create\)/i,
  ];

  const violations = [];
  for (const { file, text } of readSurface()) {
    for (const pattern of banned) {
      if (pattern.test(text)) violations.push(`${file}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('UserPromptSubmit checkpoint recovery prefers existing mel refinement before creation', () => {
  const text = readFileSync(join(ROOT.pathname, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /search existing mels first/i);
  assert.match(text, /prefer \\?`mel_patch\\?` \/ \\?`mel_update\\?`/i);
  assert.match(text, /use \\?`mel_create\\?` only for genuinely new memory/i);
});

test('UserPromptSubmit checkpoint recovery preserves evidence status for uncertain signals', () => {
  const text = readFileSync(join(ROOT.pathname, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /user-reported observations need \\?`user-reported\\?` \+ \\?`needs-verification\\?`/i);
  assert.match(text, /hypotheses should become verification tasks/i);
});

test('UserPromptSubmit reminders prefer existing task before task_create', () => {
  const text = readFileSync(join(ROOT.pathname, 'scripts/on_user_prompt_submit.mjs'), 'utf8');

  assert.match(text, /If an existing task matches this work/i);
  assert.match(text, /If no existing task matches, call \\?`task_create\\?`/i);
});

test('Session bootstrap and prompt recovery form a compact session brief', () => {
  const sessionStart = readFileSync(join(ROOT.pathname, 'scripts/on_session_start.mjs'), 'utf8');
  const userPrompt = readFileSync(join(ROOT.pathname, 'scripts/on_user_prompt_submit.mjs'), 'utf8');
  for (const text of [sessionStart, userPrompt]) {
    assert.match(text, /session brief/i);
    assert.match(text, /hive_context_get/i);
    assert.match(text, /handoff/i);
    assert.match(text, /sort: "recency"/i);
    assert.match(text, /<inferred project name>/i);
    assert.doesNotMatch(text, /<cwd basename>|<repo name>|raw filesystem paths/i);
  }

  assert.match(userPrompt, /patch\/update before create/i);
  assert.match(userPrompt, /user-reported needs verification/i);
  assert.match(userPrompt, /hypotheses become verification tasks/i);
});

// AGENTS.md carries a third, independent copy of the same recall flow — the one
// Codex and other AGENTS.md-reading hosts get. It is not phrased like the hook
// blocks (no "session brief" / "handoff" wording), so only the call sequence is
// compared here. Without this, AGENTS.md is free to keep an older recall path
// while both hooks have already moved on, and nothing fails.
test('AGENTS.md describes the same recall call sequence as the hooks', () => {
  const agents = readFileSync(join(ROOT.pathname, 'AGENTS.md'), 'utf8');

  assert.match(agents, /hive_search/i);
  assert.match(agents, /hive_context_get/i);
  assert.match(agents, /sort="recency"|sort: "recency"/i);
  assert.match(agents, /<inferred project name>/i);
  // and has not reverted to the superseded path (fetching the map with mel_search)
  assert.doesNotMatch(agents, /tags=\["project-orientation"\]|tags: \["project-orientation"\]/i);
  assert.doesNotMatch(agents, /<cwd basename>|<repo name>|raw filesystem paths/i);

  // Hooks are opt-in on Codex: they need `codex features enable plugin_hooks`
  // plus a manual approval per hook, and changing a hook definition revokes
  // that approval until it is granted again. So a user can be fully set up and
  // still receive none of the hook text. Standing guidance therefore has to
  // exist in AGENTS.md as well — moving it into a hook block alone silently
  // drops it for everyone who has not opted in.
  assert.match(agents, /rules_edit/i);
  assert.match(agents, /rules_patch/i);
});

// README documents the same recall flow a fourth time, for readers who never
// see a hook or a skill body. It was the one copy no test looked at, so it kept
// describing the superseded orientation lookup after all three other surfaces
// had moved on — caught by review, not by any check.
test('README describes the current recall flow', () => {
  const readme = readFileSync(join(ROOT.pathname, 'README.md'), 'utf8');

  assert.match(readme, /hive_search/);
  assert.match(readme, /hive_context_get/);
  assert.doesNotMatch(readme, /orientation `mel_search`|tags=?\["project-orientation"\]/i);
  // hooks/codex-hooks.json has never existed; naming it sends readers to a file
  // that is not there.
  assert.doesNotMatch(readme, /codex-hooks/);

  // Rules are a third stored thing alongside mels and tasks, with their own
  // tools and their own precedence. Listing them as a feature without ever
  // saying what they are leaves a reader who only has the README unable to use
  // them, so require the concept and the provenance guarantee, not just the word.
  assert.match(readme, /\*\*rules\*\*/);
  assert.match(readme, /mels record what is true, rules record what to do/i);
  assert.match(readme, /Rules come from you, not from what an agent read/i);
});
