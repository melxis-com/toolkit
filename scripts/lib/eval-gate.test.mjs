import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('../../', import.meta.url);
const semantic = {
  'ordinary-shared-evidence': ['reads-own-guide', 'applies-own-guide', 'uses-shared-evidence'],
  'shared-only-ordinary': ['applies-evidence'],
  'direct-guide-capture': ['records-practice'],
  'note-routing': ['one-event-one-sentence'],
  'saved-correction-next-agent': ['correction-is-usable'],
  'superseded-not-applied': ['uses-current-decision'],
  'stale-mel-checked': ['checks-against-current'],
  'decision-premise-changed': ['revisits-on-new-premise'],
  'decision-premise-unchanged': ['weighs-with-the-record'],
};
const indicators = {
  'note-routing': ['kind-used', 'lands-as-a-note'],
  'blocked-on-external': ['kind-used'],
};
function fixture() {
  return { suite: { plugins: [{ name: 'melxis' }] }, cases: [...new Set([...Object.keys(semantic), ...Object.keys(indicators)])].map((name) => ({
    name, graders: [...(semantic[name] ?? []).map((name) => ({ name, type: 'llm' })),
      ...(indicators[name] ?? []).map((name) => ({ name, type: 'regex', config: { target: 'mock_calls', pattern: 'task_note', match: 'contains' } })),
      { name: 'boundary', type: 'tool_used' }],
    arms: { with: Array.from({ length: 3 }, () => ({ error: null, skippedPaidGraders: false,
      graders: [...[...(semantic[name] ?? []), ...(indicators[name] ?? [])].map((name) => ({ name, passed: true, scored: false })), { name: 'boundary', passed: true, scored: true }],
    })), without: [{ graders: [...(semantic[name] ?? []), ...(indicators[name] ?? [])].map((name) => ({ name, passed: false })) }] },
  })) };
}
function gate(run) {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-eval-gate-'));
  try {
    writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify(run));
    return spawnSync(process.execPath, ['evals/gate.mjs', dir], { cwd: root, encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('gate accepts complete three-run semantic evidence even when CLI excludes it from scores', () => {
  const result = gate(fixture()); assert.equal(result.status, 0, result.stdout + result.stderr);
});
const negatives = {
  'absent required case': (run) => run.cases.shift(),
  'empty with arm': (run) => { run.cases[0].arms.with = []; },
  'only without arm': (run) => { delete run.cases[0].arms.with; },
  'fewer than three runs': (run) => run.cases[0].arms.with.pop(),
  'missing semantic definition': (run) => run.cases[0].graders.shift(),
  'missing semantic grade': (run) => run.cases[0].arms.with[0].graders.shift(),
  'one scored:false semantic failure among three runs': (run) => { run.cases[0].arms.with[0].graders[0].passed = false; },
  'nonboolean pass': (run) => { run.cases[1].arms.with[0].graders[0].passed = 'true'; },
  'paid graders skipped': (run) => { run.cases[1].arms.with[0].skippedPaidGraders = true; },
  'run error': (run) => { run.cases[2].arms.with[0].error = 'timeout'; },
  'mock guard abortion': (run) => { run.cases[2].arms.with[0].aborted = { server: 'melxis', tool: 'task_note', reason: 'guard' }; },
};
for (const [name, mutate] of Object.entries(negatives)) test(`gate fails closed: ${name}`, () => {
  const run = fixture(); mutate(run); const result = gate(run);
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
for (const [caseName, names] of Object.entries(indicators)) for (const name of names) {
  const negativeIndicators = {
    'missing definition': (c) => { c.graders = c.graders.filter((g) => g.name !== name); },
    'duplicate definition including wrong type': (c) => { c.graders.push({ name, type: 'llm' }); },
    'wrong definition type': (c) => { c.graders.find((g) => g.name === name).type = 'tool_used'; },
    'missing mock_calls target': (c) => { delete c.graders.find((g) => g.name === name).config.target; },
    'wrong mock_calls target': (c) => { c.graders.find((g) => g.name === name).config.target = 'last_message'; },
    'missing grade': (c) => { c.arms.with[1].graders = c.arms.with[1].graders.filter((g) => g.name !== name); },
    'duplicate grade': (c) => { c.arms.with[1].graders.push({ name, passed: true, scored: false }); },
    'one scored:false failure out of three': (c) => { c.arms.with[1].graders.find((g) => g.name === name).passed = false; },
    'one scored:true failure out of three': (c) => { Object.assign(c.arms.with[1].graders.find((g) => g.name === name), { passed: false, scored: true }); },
    'nonboolean pass': (c) => { c.arms.with[1].graders.find((g) => g.name === name).passed = 'true'; },
    'skipped passing grade': (c) => { c.arms.with[1].graders.find((g) => g.name === name).skipped = true; },
  };
  for (const [condition, mutate] of Object.entries(negativeIndicators)) test(`gate requires ${caseName}/${name}: ${condition}`, () => {
    const run = fixture(); mutate(run.cases.find((c) => c.name === caseName));
    const result = gate(run); assert.equal(result.status, 1, result.stdout + result.stderr);
  });
}
for (const [condition, mutate] of Object.entries({
  'absent case': (run) => { run.cases = run.cases.filter((c) => c.name !== 'blocked-on-external'); },
  'duplicate case': (run) => { run.cases.push(structuredClone(run.cases.at(-1))); },
  'missing with arm': (run) => { delete run.cases.at(-1).arms.with; },
  'empty with arm': (run) => { run.cases.at(-1).arms.with = []; },
  'fewer than three runs': (run) => { run.cases.at(-1).arms.with.pop(); },
})) test(`gate requires blocked indicator evidence: ${condition}`, () => {
  const run = fixture(); mutate(run); const result = gate(run);
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
test('gate rejects an extra same-name semantic definition of another type', () => {
  const run = fixture(); run.cases[0].graders.push({ name: 'reads-own-guide', type: 'regex' });
  assert.equal(gate(run).status, 1);
});
test('gate retains majority handling for other deterministic checks', () => {
  const run = fixture(); run.cases[0].arms.with[0].graders.at(-1).passed = false;
  const result = gate(run); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /flaky.*boundary/);
});
test('gate retains deterministic boundary checks', () => {
  const run = fixture(); for (const r of run.cases[0].arms.with) r.graders.at(-1).passed = false;
  assert.equal(gate(run).status, 1);
});
