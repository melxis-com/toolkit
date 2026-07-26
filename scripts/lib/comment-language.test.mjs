import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

// This toolkit is public and read by people who do not share one first language,
// so comments and docstrings are written in English.
//
// Japanese still appears legitimately, and must keep appearing: the hooks detect
// Japanese prompts, so the patterns they match against contain Japanese, and the
// skills document Japanese trigger phrases so an agent recognises them. Those
// are data. The rule is about prose written for the reader of the source.
const CJK = /[぀-ゟ゠-ヿ㐀-䶿一-鿿]/;

/** Source files tracked by git, so generated and ignored trees stay out. */
function trackedSources() {
  return execFileSync('git', ['ls-files', '*.mjs', '*.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * Lines that are comments in their entirety: `// ...`, and the `*` / `/*` lines
 * of a block comment. Trailing comments after code are deliberately not parsed —
 * telling a real `//` from one inside a string needs a tokenizer, and a wrong
 * split would make this check either noisy or quietly useless. Whole-line
 * comments are where explanation actually lives.
 */
function commentLines(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /^\s*(\/\/|\*\/?|\/\*)/.test(line));
}

test('comments in tracked sources are written in English', () => {
  const violations = [];

  for (const file of trackedSources()) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const { line, no } of commentLines(text)) {
      if (CJK.test(line)) violations.push(`${file}:${no}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `non-English comment(s) — this repo is public, write comments in English ` +
      `(Japanese inside match patterns and documented trigger phrases is fine, ` +
      `it is data rather than prose):\n${violations.join('\n')}`,
  );
});

/**
 * Titles passed to test() / describe(). These are prose for a reader too — they
 * are what a contributor sees in CI output — but they are string arguments, so
 * the comment scan above never looked at them and a whole set of Japanese titles
 * survived a pass that reported the repo clean.
 *
 * Assertion failure messages have the same character and are not covered:
 * telling a message argument from a Japanese *fixture* string needs to parse
 * call arguments, and the fixtures must stay Japanese for the hooks that match
 * Japanese prompts. Titles are matched precisely, so they are checked; messages
 * are left to review.
 */
function testTitles(text) {
  return [...text.matchAll(/^\s*(?:test|describe|it)\(\s*(['"`])(.*?)\1/gm)].map((m) => ({
    title: m[2],
    no: text.slice(0, m.index).split('\n').length,
  }));
}

test('test titles are written in English', () => {
  const violations = [];

  for (const file of trackedSources()) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const { title, no } of testTitles(text)) {
      if (CJK.test(title)) violations.push(`${file}:${no}: ${title}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `non-English test title(s) — they show up in CI output for every reader:\n${violations.join('\n')}`,
  );
});

test('the title check reads titles and not fixtures', () => {
  const sample = [
    "test('recall stays blended', () => {",
    "  const prompt = 'この WebSocket バグを調査して修正してほしい';",
    '});',
    "test('日本語のタイトル', () => {});",
  ].join('\n');

  const found = testTitles(sample);
  assert.deepEqual(
    found.map((f) => f.title),
    ['recall stays blended', '日本語のタイトル'],
  );
  assert.equal(found.filter((f) => CJK.test(f.title)).length, 1);
});

test('the check would catch a non-English comment', () => {
  // Guard the guard: a detector that cannot fail is indistinguishable from one
  // that passes because the repo is clean.
  const sample = ['const a = 1;', '  // これは日本語のコメント', 'const b = 2;'].join('\n');
  const found = commentLines(sample).filter(({ line }) => CJK.test(line));

  assert.equal(found.length, 1);
  assert.equal(found[0].no, 2);
});

test('Japanese inside patterns and strings is left alone', () => {
  // The hooks must keep matching Japanese prompts; flagging these would push
  // someone to delete working detection to make a lint pass.
  const sample = ["const RE = /(実装|修正)/i;", 'const s = "残っているタスク";'].join('\n');

  assert.deepEqual(commentLines(sample), []);
});
