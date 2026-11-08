import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Hook text reaches the model only up to a cap: Claude Code truncates hook
// context at 10,000 characters, and Codex spills a hook message over roughly
// 2,500 tokens to a file and shows only an excerpt. The budget keeps headroom
// below the Claude cap for every session source and write policy, so a later
// addition fails here instead of being cut off silently. 9,000 keeps a tenth
// of the Claude cap free.
const ROOT = new URL('../../', import.meta.url).pathname;
const BUDGET_CHARS = 9000;

for (const policy of ['auto', 'smart', 'confirm']) {
  for (const source of ['startup', 'resume', 'compact', 'clear']) {
    test(`SessionStart ${source} output under ${policy} stays within the hook budget`, () => {
      const out = execFileSync(process.execPath, [join(ROOT, 'scripts/on_session_start.mjs')], {
        input: JSON.stringify({ source }),
        env: { ...process.env, MELXIS_WRITE_POLICY: policy },
        encoding: 'utf8',
      });
      assert.ok(out.length <= BUDGET_CHARS, `${out.length} chars > ${BUDGET_CHARS}`);
    });
  }
}
