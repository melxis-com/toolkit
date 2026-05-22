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
    assert.match(text, /project-orientation/i);
    assert.match(text, /handoff/i);
    assert.match(text, /sort: "recency"/i);
    assert.match(text, /<inferred project name>/i);
    assert.doesNotMatch(text, /<cwd basename>|<repo name>|raw filesystem paths/i);
  }

  assert.match(userPrompt, /patch\/update before create/i);
  assert.match(userPrompt, /user-reported needs verification/i);
  assert.match(userPrompt, /hypotheses become verification tasks/i);
});
